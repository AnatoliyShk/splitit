from django.core.management.base import BaseCommand

from apps.occasions.services import deactivate_finished


class Command(BaseCommand):
    help = "Mark attendances of ended or cancelled occasions inactive, so their users can join another occasion."

    def handle(self, *args, **options):
        changed = deactivate_finished()
        self.stdout.write(f"Deactivated {changed} attendance(s).")
