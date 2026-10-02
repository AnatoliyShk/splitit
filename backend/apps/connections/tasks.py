from django.tasks import task

from .services import apply_event


@task
def apply_event_connections(event_id):
    # A job that runs before the event ends (its time moved later) does nothing; the newer job counts it
    apply_event(event_id)
