from django.conf import settings
from django.db import models
from pgvector.django import HnswIndex, VectorField

# Size of the vectors stored in `embedding` columns (shared with tags)
EMBEDDING_DIMENSIONS = 768


class Event(models.Model):
    name = models.CharField(max_length=255)
    start_datetime = models.DateTimeField(db_index=True)
    end_datetime = models.DateTimeField(null=True, blank=True)
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="events",
        blank=True,
    )
    # Filled by an embedding model, not by people, so it's hidden from forms and the API
    embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # Approximate nearest-neighbour search by cosine distance
            HnswIndex(
                name="event_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_datetime__isnull=True)
                | models.Q(end_datetime__gt=models.F("start_datetime")),
                name="event_ends_after_start",
                violation_error_message="The end must be after the start.",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def duration(self):
        """How long the event runs (a timedelta), or None when it has no end."""
        if self.end_datetime is None:
            return None
        return self.end_datetime - self.start_datetime
