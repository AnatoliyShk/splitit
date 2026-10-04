from django.contrib import admin
from django.db.models import Count

from .models import Tag


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "occasions_count", "has_embedding", "created_at")
    search_fields = ("name",)
    filter_horizontal = ("occasions",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(occasions_count=Count("occasions"))

    @admin.display(description="Occasions", ordering="occasions_count")
    def occasions_count(self, tag):
        return tag.occasions_count

    @admin.display(description="Embedding", boolean=True)
    def has_embedding(self, tag):
        return tag.embedding is not None
