from django.db import DataError, transaction
from django.test import TestCase
from django.utils import timezone
from pgvector.django import CosineDistance

from .models import EMBEDDING_DIMENSIONS, Occasion


def one_hot(i):
    """A unit vector pointing along axis i, so cosine distances are easy to predict."""
    v = [0.0] * EMBEDDING_DIMENSIONS
    v[i] = 1.0
    return v


class OccasionEmbeddingTests(TestCase):
    def create(self, name, embedding=None):
        return Occasion.objects.create(name=name, start_datetime=timezone.now(), embedding=embedding)

    def test_embedding_is_optional(self):
        self.assertIsNone(self.create("No vector").embedding)

    def test_round_trip(self):
        occasion = self.create("Gig", [0.5] * EMBEDDING_DIMENSIONS)
        occasion.refresh_from_db()
        self.assertEqual(len(occasion.embedding), EMBEDDING_DIMENSIONS)
        self.assertAlmostEqual(occasion.embedding[0], 0.5)

    def test_wrong_dimensions_are_rejected(self):
        with self.assertRaises(DataError), transaction.atomic():
            self.create("Bad", [0.1] * 3)

    def test_orders_by_cosine_distance(self):
        self.create("Far", one_hot(1))
        self.create("Near", [0.9, 0.1] + [0.0] * (EMBEDDING_DIMENSIONS - 2))
        self.create("Same", one_hot(0))
        self.create("No vector")

        nearest = (
            Occasion.objects.exclude(embedding=None)
            .annotate(distance=CosineDistance("embedding", one_hot(0)))
            .order_by("distance")
        )
        self.assertEqual([o.name for o in nearest], ["Same", "Near", "Far"])
        self.assertAlmostEqual(nearest[0].distance, 0.0, places=6)


class UserOccasionsApiTests(TestCase):
    def setUp(self):
        from datetime import timedelta

        from apps.tags.models import Tag
        from apps.users.models import User

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben")
        now = timezone.now()
        later = Occasion.objects.create(name="Later", start_datetime=now + timedelta(days=5))
        sooner = Occasion.objects.create(name="Sooner", start_datetime=now + timedelta(days=1))
        not_mine = Occasion.objects.create(name="Not mine", start_datetime=now)
        later.users.add(self.me, self.other)
        sooner.users.add(self.me)
        not_mine.users.add(self.other)
        Tag.objects.create(name="Jazz").occasions.add(later)
        self.client.force_login(self.me)

    def url(self, user):
        return f"/api/users/{user.uuid}/occasions/"

    def test_lists_only_that_users_occasions_soonest_first(self):
        data = self.client.get(self.url(self.me)).json()
        self.assertEqual([o["name"] for o in data], ["Sooner", "Later"])
        self.assertEqual(data[1]["attendees_count"], 2)
        self.assertEqual(data[1]["tags"], ["Jazz"])

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url(self.me)).status_code, 403)

    def test_other_users_occasions_are_hidden(self):
        self.assertEqual(self.client.get(self.url(self.other)).status_code, 404)

    def test_unknown_or_malformed_uuid_is_404(self):
        import uuid

        self.me.is_staff = True
        self.me.save()
        self.assertEqual(self.client.get(f"/api/users/{uuid.uuid4()}/occasions/").status_code, 404)
        self.assertEqual(self.client.get("/api/users/123/occasions/").status_code, 404)

    def test_staff_can_view_anyones_occasions(self):
        self.me.is_staff = True
        self.me.save()
        data = self.client.get(self.url(self.other)).json()
        self.assertEqual([o["name"] for o in data], ["Not mine", "Later"])


class ExploreApiTests(TestCase):
    def setUp(self):
        from datetime import timedelta

        from apps.users.models import User

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben")
        now = timezone.now()
        self.later = Occasion.objects.create(name="Later", start_datetime=now + timedelta(days=5))
        self.sooner = Occasion.objects.create(name="Sooner", start_datetime=now + timedelta(days=1))
        self.running = Occasion.objects.create(
            name="Running", start_datetime=now - timedelta(hours=1), end_datetime=now + timedelta(hours=1)
        )
        self.mine = Occasion.objects.create(name="Mine", start_datetime=now + timedelta(days=2))
        self.past = Occasion.objects.create(name="Past", start_datetime=now - timedelta(days=1))
        self.mine.users.add(self.me)
        self.later.users.add(self.other)
        self.client.force_login(self.me)

    def test_lists_upcoming_occasions_im_not_going_to_soonest_first(self):
        data = self.client.get("/api/occasions/explore/").json()
        self.assertEqual([o["name"] for o in data], ["Running", "Sooner", "Later"])
        self.assertEqual(data[2]["attendees_count"], 1)

    def test_join_adds_me_and_drops_the_occasion_from_explore(self):
        res = self.client.post(f"/api/occasions/{self.sooner.id}/join/")
        self.assertEqual(res.status_code, 204)
        self.assertTrue(self.sooner.users.filter(id=self.me.id).exists())
        names = [o["name"] for o in self.client.get("/api/occasions/explore/").json()]
        self.assertNotIn("Sooner", names)

    def test_cannot_join_past_or_unknown_occasions(self):
        self.assertEqual(self.client.post(f"/api/occasions/{self.past.id}/join/").status_code, 404)
        self.assertEqual(self.client.post("/api/occasions/999999/join/").status_code, 404)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/occasions/explore/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/occasions/{self.sooner.id}/join/").status_code, 403)
