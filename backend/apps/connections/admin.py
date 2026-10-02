from django.contrib import admin

from .models import Connection


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    """Read-only: connections are counted from events, not edited by hand."""

    list_display = ("user_low", "user_high", "strength", "shared_events", "updated_at")
    search_fields = ("user_low__email", "user_low__name", "user_high__email", "user_high__name")
    list_select_related = ("user_low", "user_high")
    ordering = ("-strength",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
