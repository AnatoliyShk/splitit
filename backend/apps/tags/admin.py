from django.contrib import admin
from django.db.models import Count

from .models import Tag


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "events_count", "created_at")
    search_fields = ("name",)
    filter_horizontal = ("events",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(events_count=Count("events"))

    @admin.display(description="Events", ordering="events_count")
    def events_count(self, tag):
        return tag.events_count
