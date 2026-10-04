from django.contrib import admin

from .models import Occasion


@admin.register(Occasion)
class OccasionAdmin(admin.ModelAdmin):
    list_display = ("name", "start_datetime", "end_datetime", "duration", "created_at")
    search_fields = ("name",)
    filter_horizontal = ("users",)
