from django.apps import AppConfig


class OccasionsConfig(AppConfig):
    name = 'apps.occasions'

    def ready(self):
        from . import signals

        signals.connect()
