from django.db import DataError, transaction
from django.test import TestCase
from django.utils import timezone
from pgvector.django import CosineDistance

from .models import EMBEDDING_DIMENSIONS, Event


def one_hot(i):
    """A unit vector pointing along axis i, so cosine distances are easy to predict."""
    v = [0.0] * EMBEDDING_DIMENSIONS
    v[i] = 1.0
    return v


class EventEmbeddingTests(TestCase):
    def create(self, name, embedding=None):
        return Event.objects.create(name=name, start_datetime=timezone.now(), embedding=embedding)

    def test_embedding_is_optional(self):
        self.assertIsNone(self.create("No vector").embedding)

    def test_round_trip(self):
        event = self.create("Gig", [0.5] * EMBEDDING_DIMENSIONS)
        event.refresh_from_db()
        self.assertEqual(len(event.embedding), EMBEDDING_DIMENSIONS)
        self.assertAlmostEqual(event.embedding[0], 0.5)

    def test_wrong_dimensions_are_rejected(self):
        with self.assertRaises(DataError), transaction.atomic():
            self.create("Bad", [0.1] * 3)

    def test_orders_by_cosine_distance(self):
        self.create("Far", one_hot(1))
        self.create("Near", [0.9, 0.1] + [0.0] * (EMBEDDING_DIMENSIONS - 2))
        self.create("Same", one_hot(0))
        self.create("No vector")

        nearest = (
            Event.objects.exclude(embedding=None)
            .annotate(distance=CosineDistance("embedding", one_hot(0)))
            .order_by("distance")
        )
        self.assertEqual([e.name for e in nearest], ["Same", "Near", "Far"])
        self.assertAlmostEqual(nearest[0].distance, 0.0, places=6)
