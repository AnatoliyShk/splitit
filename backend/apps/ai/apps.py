from django.apps import AppConfig


class AiConfig(AppConfig):
    name = 'apps.ai'

    def ready(self):
        from . import signals

        signals.connect()
