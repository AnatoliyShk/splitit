from django.contrib import admin

from .models import Membership, SocialCircle


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    autocomplete_fields = ("user",)
    ordering = ("-interest",)


@admin.register(SocialCircle)
class SocialCircleAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at", "updated_at")
    search_fields = ("name",)
    inlines = (MembershipInline,)
