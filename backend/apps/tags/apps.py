from django.apps import AppConfig


class TagsConfig(AppConfig):
    name = 'apps.tags'

    def ready(self):
        from . import signals

        signals.connect()
