from django.apps import AppConfig


class UsersConfig(AppConfig):
    name = 'apps.users'

    def ready(self):
        # Registers the API docs extension for CsrfEnforcedSessionAuthentication
        from . import schema  # noqa: F401
