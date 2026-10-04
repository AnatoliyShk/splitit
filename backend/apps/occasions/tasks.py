from django.tasks import task

from .services import deactivate_finished


@task
def deactivate_finished_attendances():
    # Sweeps every finished occasion, so a job that runs early (its end moved later) is harmless
    deactivate_finished()
