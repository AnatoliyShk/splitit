from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.utils import timezone

from apps.occasions.models import Occasion

from .cache import invalidate_users
from .models import Connection
from .tasks import apply_occasion_connections


def schedule(occasion_id):
    # Read the saved row: the instance may hold unparsed values (e.g. ISO strings) or be stale
    occasion = Occasion.objects.filter(pk=occasion_id, connections_applied_at__isnull=True).first()
    if occasion is None:
        return
    task = apply_occasion_connections
    # Hold the job until the occasion ends, when the backend can defer (Django's ImmediateBackend can't)
    if occasion.ends_at > timezone.now() and task.get_backend().supports_defer:
        task = task.using(run_after=occasion.ends_at)
    task.enqueue(occasion.pk)


def occasion_saved(sender, instance, **kwargs):
    transaction.on_commit(lambda: schedule(instance.pk))


def connection_deleted(sender, instance, **kwargs):
    # A deleted user's connections go by cascade; the people on the other side need fresh lists
    transaction.on_commit(lambda: invalidate_users([instance.user_low_id, instance.user_high_id]))


def connect():
    post_save.connect(occasion_saved, sender=Occasion, dispatch_uid="connections-schedule-occasion")
    post_delete.connect(connection_deleted, sender=Connection, dispatch_uid="connections-connection-delete")
