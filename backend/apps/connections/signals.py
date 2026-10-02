from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.utils import timezone

from apps.events.models import Event

from .cache import invalidate_users
from .models import Connection
from .tasks import apply_event_connections


def schedule(event_id):
    # Read the saved row: the instance may hold unparsed values (e.g. ISO strings) or be stale
    event = Event.objects.filter(pk=event_id, connections_applied_at__isnull=True).first()
    if event is None:
        return
    task = apply_event_connections
    # Hold the job until the event ends, when the backend can defer (Django's ImmediateBackend can't)
    if event.ends_at > timezone.now() and task.get_backend().supports_defer:
        task = task.using(run_after=event.ends_at)
    task.enqueue(event.pk)


def event_saved(sender, instance, **kwargs):
    transaction.on_commit(lambda: schedule(instance.pk))


def connection_deleted(sender, instance, **kwargs):
    # A deleted user's connections go by cascade; the people on the other side need fresh lists
    transaction.on_commit(lambda: invalidate_users([instance.user_low_id, instance.user_high_id]))


def connect():
    post_save.connect(event_saved, sender=Event, dispatch_uid="connections-schedule-event")
    post_delete.connect(connection_deleted, sender=Connection, dispatch_uid="connections-connection-delete")
