from django.contrib import admin

from .models import Occasion, OccasionImage, OccasionTemplate, OccasionTemplateImage, OccasionUser


class OccasionUserInline(admin.TabularInline):
    model = OccasionUser
    extra = 0
    raw_id_fields = ("user",)


class OccasionImageInline(admin.TabularInline):
    model = OccasionImage
    extra = 0


@admin.register(Occasion)
class OccasionAdmin(admin.ModelAdmin):
    list_display = ("name", "start_datetime", "end_datetime", "duration", "cancelled_at", "created_at")
    search_fields = ("name",)
    readonly_fields = ("cancelled_at",)
    # An explicit through model rules out filter_horizontal, so attendees are edited inline
    inlines = [OccasionImageInline, OccasionUserInline]


class OccasionTemplateImageInline(admin.TabularInline):
    model = OccasionTemplateImage
    extra = 0


@admin.register(OccasionTemplate)
class OccasionTemplateAdmin(admin.ModelAdmin):
    inlines = [OccasionTemplateImageInline]
    list_display = ("name", "duration_minutes", "created_at")
    search_fields = ("name",)
    filter_horizontal = ("tags",)
