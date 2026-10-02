from django.apps import AppConfig


class ConnectionsConfig(AppConfig):
    name = 'apps.connections'

    def ready(self):
        from . import signals

        signals.connect()
