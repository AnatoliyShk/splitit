from django.apps import AppConfig


class CirclesConfig(AppConfig):
    name = 'apps.circles'

    def ready(self):
        from . import signals

        signals.connect()
