from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("name", "start_datetime", "end_datetime", "duration", "created_at")
    search_fields = ("name",)
    filter_horizontal = ("users",)
