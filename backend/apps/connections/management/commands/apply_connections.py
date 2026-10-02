from django.core.management.base import BaseCommand
from django.db import transaction

from apps.connections.cache import invalidate_all
from apps.connections.models import Connection
from apps.connections.services import apply_event, unapplied_ended_events
from apps.events.models import Event


class Command(BaseCommand):
    help = "Count connections for every ended event that hasn't been counted yet."

    def add_arguments(self, parser):
        parser.add_argument(
            "--rebuild",
            action="store_true",
            help="Delete all connections and count every ended event again.",
        )

    def handle(self, *args, rebuild=False, **options):
        if rebuild:
            with transaction.atomic():
                # Raw delete: skips per-row signals, since every cached list is dropped below anyway
                Connection.objects.all()._raw_delete(Connection.objects.db)
                Event.objects.update(connections_applied_at=None)
            invalidate_all()
        applied = sum(apply_event(pk) for pk in unapplied_ended_events().values_list("pk", flat=True))
        self.stdout.write(f"Counted connections for {applied} event(s).")
