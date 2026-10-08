from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.utils import timezone

from .models import Occasion, OccasionImage, OccasionTemplateImage
from .tasks import deactivate_finished_attendances


def schedule(occasion_id):
    # Read the saved row: the instance may hold unparsed values (e.g. ISO strings) or be stale
    occasion = Occasion.objects.filter(pk=occasion_id).first()
    if occasion is None:
        return
    deactivate_task = deactivate_finished_attendances
    # Hold the job until the occasion ends, when the backend can defer (Django's ImmediateBackend can't)
    can_defer = deactivate_task.get_backend().supports_defer
    if occasion.cancelled_at is None and occasion.ends_at > timezone.now() and can_defer:
        deactivate_task = deactivate_task.using(run_after=occasion.ends_at)
    deactivate_task.enqueue()


def occasion_saved(sender, instance, **kwargs):
    transaction.on_commit(lambda: schedule(instance.pk))


def image_deleted(sender, instance, **kwargs):
    # Remove the file only once the row is really gone (a rolled-back delete keeps both)
    file = instance.image
    transaction.on_commit(lambda: file.delete(save=False))


def connect():
    post_save.connect(occasion_saved, sender=Occasion, dispatch_uid="occasions-schedule-deactivate")
    # Also runs for each image when its occasion is deleted (cascade)
    post_delete.connect(image_deleted, sender=OccasionImage, dispatch_uid="occasions-delete-image-file")
    post_delete.connect(
        image_deleted, sender=OccasionTemplateImage, dispatch_uid="occasions-delete-template-image-file"
    )
