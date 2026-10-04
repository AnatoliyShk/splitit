from django.db import models
from django.db.models.functions import Lower
from pgvector.django import HnswIndex, VectorField

from apps.occasions.models import EMBEDDING_DIMENSIONS


class Tag(models.Model):
    name = models.CharField(max_length=50)
    occasions = models.ManyToManyField(
        "occasions.Occasion",
        related_name="tags",
        blank=True,
        db_table="tag_occasions",
    )
    # Filled by an embedding model, not by people, so it's hidden from forms and the API
    embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tags"
        indexes = [
            # Approximate nearest-neighbour search by cosine distance
            HnswIndex(
                name="tag_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]
        constraints = [
            # "Jazz" and "jazz" are the same tag
            models.UniqueConstraint(
                Lower("name"),
                name="tag_name_unique_ci",
                violation_error_message="A tag with this name already exists.",
            ),
        ]

    def __str__(self):
        return self.name
