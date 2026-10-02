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


class UserEventsApiTests(TestCase):
    def setUp(self):
        from datetime import timedelta

        from apps.tags.models import Tag
        from apps.users.models import User

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben")
        now = timezone.now()
        later = Event.objects.create(name="Later", start_datetime=now + timedelta(days=5))
        sooner = Event.objects.create(name="Sooner", start_datetime=now + timedelta(days=1))
        not_mine = Event.objects.create(name="Not mine", start_datetime=now)
        later.users.add(self.me, self.other)
        sooner.users.add(self.me)
        not_mine.users.add(self.other)
        Tag.objects.create(name="Jazz").events.add(later)
        self.client.force_login(self.me)

    def url(self, user):
        return f"/api/users/{user.uuid}/events/"

    def test_lists_only_that_users_events_soonest_first(self):
        data = self.client.get(self.url(self.me)).json()
        self.assertEqual([e["name"] for e in data], ["Sooner", "Later"])
        self.assertEqual(data[1]["attendees_count"], 2)
        self.assertEqual(data[1]["tags"], ["Jazz"])

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url(self.me)).status_code, 403)

    def test_other_users_events_are_hidden(self):
        self.assertEqual(self.client.get(self.url(self.other)).status_code, 404)

    def test_unknown_or_malformed_uuid_is_404(self):
        import uuid

        self.me.is_staff = True
        self.me.save()
        self.assertEqual(self.client.get(f"/api/users/{uuid.uuid4()}/events/").status_code, 404)
        self.assertEqual(self.client.get("/api/users/123/events/").status_code, 404)

    def test_staff_can_view_anyones_events(self):
        self.me.is_staff = True
        self.me.save()
        data = self.client.get(self.url(self.other)).json()
        self.assertEqual([e["name"] for e in data], ["Not mine", "Later"])
