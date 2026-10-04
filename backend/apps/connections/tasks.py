from django.tasks import task

from .services import apply_occasion


@task
def apply_occasion_connections(occasion_id):
    # A job that runs before the occasion ends (its time moved later) does nothing; the newer job counts it
    apply_occasion(occasion_id)
