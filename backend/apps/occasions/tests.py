from datetime import timedelta

from django.db import DataError, transaction
from django.tasks import default_task_backend
from django.test import TestCase, override_settings
from django.utils import timezone
from pgvector.django import CosineDistance

from .models import EMBEDDING_DIMENSIONS, Occasion, OccasionUser
from .services import deactivate_finished


def one_hot(axis):
    """A unit vector pointing along `axis`, so cosine distances are easy to predict."""
    vector = [0.0] * EMBEDDING_DIMENSIONS
    vector[axis] = 1.0
    return vector


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
        self.assertEqual([occasion.name for occasion in nearest], ["Same", "Near", "Far"])
        self.assertAlmostEqual(nearest[0].distance, 0.0, places=6)


class UserOccasionsApiTests(TestCase):
    def setUp(self):
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
        user_occasions = self.client.get(self.url(self.me)).json()
        self.assertEqual([occasion["name"] for occasion in user_occasions], ["Sooner", "Later"])
        self.assertEqual(user_occasions[1]["attendees_count"], 2)
        self.assertEqual(user_occasions[1]["tags"], ["Jazz"])

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
        user_occasions = self.client.get(self.url(self.other)).json()
        self.assertEqual([occasion["name"] for occasion in user_occasions], ["Not mine", "Later"])


    def test_cancelled_occasions_say_so(self):
        Occasion.objects.filter(name="Later").update(cancelled_at=timezone.now())
        user_occasions = self.client.get(self.url(self.me)).json()
        self.assertIsNone(user_occasions[0]["cancelled_at"])
        self.assertIsNotNone(user_occasions[1]["cancelled_at"])


class ExploreApiTests(TestCase):
    def setUp(self):
        from apps.users.models import User

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben")
        now = timezone.now()
        self.later = Occasion.objects.create(name="Later", start_datetime=now + timedelta(days=5))
        self.sooner = Occasion.objects.create(name="Sooner", start_datetime=now + timedelta(days=1))
        self.running = Occasion.objects.create(
            name="Running", start_datetime=now - timedelta(hours=1), end_datetime=now + timedelta(hours=1)
        )
        self.cancelled = Occasion.objects.create(
            name="Cancelled", start_datetime=now + timedelta(days=2), cancelled_at=now
        )
        self.past = Occasion.objects.create(name="Past", start_datetime=now - timedelta(days=1))
        # Going to a past occasion doesn't stop me joining new ones
        self.past.users.add(self.me)
        deactivate_finished()
        self.later.users.add(self.other)
        self.client.force_login(self.me)

    def explore(self):
        return self.client.get("/api/occasions/explore/").json()

    def join(self, occasion):
        return self.client.post(f"/api/occasions/{occasion.id}/join/")

    def test_lists_upcoming_occasions_im_not_going_to_soonest_first(self):
        explore_data = self.explore()
        self.assertIsNone(explore_data["active_occasion"])
        self.assertEqual([occasion["name"] for occasion in explore_data["occasions"]], ["Running", "Sooner", "Later"])
        self.assertEqual(explore_data["occasions"][2]["attendees_count"], 1)

    def save_filters(self, tags=(), weekdays=()):
        from apps.users.models import FilterPreference, FilterPreferenceWeekday

        filter_preference = FilterPreference.objects.create(user=self.me)
        filter_preference.tags.set(tags)
        FilterPreferenceWeekday.objects.bulk_create(
            FilterPreferenceWeekday(filter_preference=filter_preference, weekday=weekday) for weekday in weekdays
        )

    def explore_names(self):
        return [occasion["name"] for occasion in self.explore()["occasions"]]

    def test_saved_tags_keep_occasions_with_any_of_them(self):
        from apps.tags.models import Tag

        jazz_tag = Tag.objects.create(name="Jazz")
        art_tag = Tag.objects.create(name="Art")
        Tag.objects.create(name="Unused")
        # Two matching tags still list the occasion once
        jazz_tag.occasions.add(self.sooner, self.later)
        art_tag.occasions.add(self.later)
        self.save_filters(tags=[jazz_tag, art_tag])
        self.assertEqual(self.explore_names(), ["Sooner", "Later"])
        self.assertEqual(self.explore()["occasions"][1]["attendees_count"], 1)

    def test_saved_weekdays_keep_occasions_starting_on_them(self):
        self.save_filters(weekdays=[self.sooner.start_datetime.isoweekday()])
        self.assertEqual(self.explore_names(), ["Sooner"])

    def test_tags_and_weekdays_must_both_match(self):
        from apps.tags.models import Tag

        jazz_tag = Tag.objects.create(name="Jazz")
        jazz_tag.occasions.add(self.sooner, self.later)
        self.save_filters(tags=[jazz_tag], weekdays=[self.later.start_datetime.isoweekday()])
        self.assertEqual(self.explore_names(), ["Later"])

    def test_empty_saved_filters_show_everything(self):
        self.save_filters()
        self.assertEqual(self.explore_names(), ["Running", "Sooner", "Later"])

    def test_names_the_attendees_i_have_a_connection_with(self):
        from apps.connections.models import Connection
        from apps.users.models import User

        # Pairs are stored smaller id first; Eve sits between Cleo and Finn, so she's on both sides
        cleo = User.objects.create_user("cleo@example.com", "correct-horse-battery", name="Cleo")
        eve = User.objects.create_user("eve@example.com", "correct-horse-battery", name="Eve")
        finn = User.objects.create_user("finn@example.com", "correct-horse-battery", name="Finn")
        self.later.users.add(cleo, finn)
        Connection.objects.create(user_low=cleo, user_high=eve, strength=1, shared_occasions=1)
        Connection.objects.create(user_low=eve, user_high=finn, strength=1, shared_occasions=1)
        # A connection between two other people isn't Eve's
        Connection.objects.create(user_low=self.other, user_high=cleo, strength=1, shared_occasions=1)
        self.client.force_login(eve)

        occasions = {occasion["name"]: occasion for occasion in self.explore()["occasions"]}
        self.assertEqual(occasions["Later"]["attendees_count"], 3)
        self.assertEqual(
            occasions["Later"]["known_attendees"],
            [{"uuid": str(cleo.uuid), "name": "Cleo"}, {"uuid": str(finn.uuid), "name": "Finn"}],
        )
        self.assertEqual(occasions["Sooner"]["known_attendees"], [])

    def test_active_occasion_names_the_attendees_i_know(self):
        from apps.connections.models import Connection

        Connection.objects.create(user_low=self.me, user_high=self.other, strength=1, shared_occasions=1)
        self.join(self.later)
        explore_data = self.explore()
        self.assertEqual(
            explore_data["active_occasion"]["known_attendees"], [{"uuid": str(self.other.uuid), "name": "Ben"}]
        )

    def test_join_makes_the_occasion_active_and_hides_the_rest(self):
        self.assertEqual(self.join(self.sooner).status_code, 204)
        self.assertTrue(OccasionUser.objects.get(occasion=self.sooner, user=self.me).is_active)
        explore_data = self.explore()
        self.assertEqual(explore_data["active_occasion"]["name"], "Sooner")
        self.assertEqual(explore_data["active_occasion"]["attendees_count"], 1)
        self.assertEqual(explore_data["occasions"], [])

    def test_cannot_join_a_second_occasion_while_one_is_active(self):
        self.join(self.sooner)
        response = self.join(self.later)
        self.assertEqual(response.status_code, 409)
        self.assertIn("You're already going to Sooner", response.json()["detail"])
        self.assertFalse(self.later.users.filter(id=self.me.id).exists())

    def test_joining_the_active_occasion_again_is_harmless(self):
        self.join(self.sooner)
        self.assertEqual(self.join(self.sooner).status_code, 204)
        self.assertEqual(self.sooner.users.count(), 1)

    def test_can_join_again_once_the_active_occasion_ends(self):
        self.join(self.running)
        Occasion.objects.filter(pk=self.running.pk).update(end_datetime=timezone.now() - timedelta(minutes=1))
        # Before the deactivate job runs, the time check already frees me...
        self.assertIsNone(self.explore()["active_occasion"])
        self.assertEqual(self.join(self.sooner).status_code, 204)
        # ...and the job turns the old attendance off
        deactivate_finished()
        self.assertFalse(OccasionUser.objects.get(occasion=self.running, user=self.me).is_active)

    def test_can_join_again_once_the_active_occasion_is_cancelled(self):
        self.join(self.sooner)
        Occasion.objects.filter(pk=self.sooner.pk).update(cancelled_at=timezone.now())
        self.assertIsNone(self.explore()["active_occasion"])
        self.assertEqual(self.join(self.later).status_code, 204)

    def test_cannot_join_past_cancelled_or_unknown_occasions(self):
        self.assertEqual(self.join(self.past).status_code, 404)
        response = self.join(self.cancelled)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "This occasion is no longer available.")
        self.assertEqual(self.client.post("/api/occasions/999999/join/").status_code, 404)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/occasions/explore/").status_code, 403)
        self.assertEqual(self.join(self.sooner).status_code, 403)


class DeactivateFinishedTests(TestCase):
    def setUp(self):
        from apps.users.models import User

        self.ana = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.ben = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben")

    def attend(self, name, **times):
        occasion = Occasion.objects.create(name=name, **times)
        occasion.users.add(self.ana, self.ben)
        return occasion

    def active(self):
        return set(OccasionUser.objects.filter(is_active=True).values_list("occasion__name", flat=True))

    def test_turns_off_ended_and_cancelled_occasions_for_everyone(self):
        now = timezone.now()
        self.attend("Ended", start_datetime=now - timedelta(hours=3), end_datetime=now - timedelta(hours=1))
        self.attend("Started, no end", start_datetime=now - timedelta(minutes=5))
        self.attend("Running", start_datetime=now - timedelta(hours=1), end_datetime=now + timedelta(hours=1))
        self.attend("Ahead", start_datetime=now + timedelta(days=1))
        self.attend("Called off", start_datetime=now + timedelta(days=1), cancelled_at=now)

        self.assertEqual(deactivate_finished(), 6)
        self.assertEqual(self.active(), {"Running", "Ahead"})
        self.assertEqual(deactivate_finished(), 0)

    def test_command_runs_the_sweep(self):
        from io import StringIO

        from django.core.management import call_command

        self.attend("Ended", start_datetime=timezone.now() - timedelta(days=1))
        out = StringIO()
        call_command("deactivate_finished", stdout=out)
        self.assertIn("Deactivated 2", out.getvalue())
        self.assertEqual(self.active(), set())


@override_settings(TASKS={"default": {"BACKEND": "django.tasks.backends.dummy.DummyBackend"}})
class DeactivateSchedulingTests(TestCase):
    def setUp(self):
        default_task_backend.clear()

    def enqueued(self):
        return [
            task_result
            for task_result in default_task_backend.results
            if task_result.task.name == "deactivate_finished_attendances"
        ]

    def test_saving_an_occasion_schedules_the_sweep_for_when_it_ends(self):
        end = timezone.now() + timedelta(days=2)
        with self.captureOnCommitCallbacks(execute=True):
            Occasion.objects.create(name="Gig", start_datetime=end - timedelta(hours=2), end_datetime=end)
        [job] = self.enqueued()
        self.assertEqual(job.task.run_after, end)

    def test_ended_or_cancelled_occasions_run_straight_away(self):
        now = timezone.now()
        with self.captureOnCommitCallbacks(execute=True):
            Occasion.objects.create(name="Past", start_datetime=now - timedelta(days=1))
            Occasion.objects.create(name="Off", start_datetime=now + timedelta(days=1), cancelled_at=now)
        self.assertEqual([job.task.run_after for job in self.enqueued()], [None, None])


class OccasionImagesApiTests(TestCase):
    def setUp(self):
        import tempfile

        from django.core.files.base import ContentFile

        from apps.users.models import User

        from .models import OccasionImage

        self.enterContext(override_settings(MEDIA_ROOT=self.enterContext(tempfile.TemporaryDirectory())))
        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana")
        self.occasion = Occasion.objects.create(name="Gig", start_datetime=timezone.now() + timedelta(days=1))
        self.plain = Occasion.objects.create(name="Plain", start_datetime=timezone.now() + timedelta(days=2))
        for order in (2, 0, 1):
            OccasionImage.objects.create(occasion=self.occasion, order=order, image=ContentFile(b"x", f"{order}.png"))
        self.client.force_login(self.me)

    def test_previews_carry_the_main_image(self):
        explore_occasions = self.client.get("/api/occasions/explore/").json()["occasions"]
        self.assertRegex(explore_occasions[0]["main_image"], rf"^/media/occasions/{self.occasion.pk}/\w+\.png$")
        self.assertIsNone(explore_occasions[1]["main_image"])

    def test_detail_has_the_gallery_in_order_without_the_main_image(self):
        occasion_data = self.client.get(f"/api/occasions/{self.occasion.pk}/").json()
        self.assertEqual(occasion_data["name"], "Gig")
        self.assertIsNotNone(occasion_data["main_image"])
        self.assertEqual(len(occasion_data["gallery"]), 2)
        self.assertNotIn(occasion_data["main_image"], occasion_data["gallery"])
        orders = dict(self.occasion.images.values_list("image", "order"))
        self.assertEqual([orders[url.removeprefix("/media/")] for url in occasion_data["gallery"]], [1, 2])

    def test_detail_says_whether_im_going(self):
        self.assertFalse(self.client.get(f"/api/occasions/{self.occasion.pk}/").json()["is_going"])
        self.occasion.users.add(self.me)
        occasion_data = self.client.get(f"/api/occasions/{self.occasion.pk}/").json()
        self.assertTrue(occasion_data["is_going"])
        self.assertEqual(occasion_data["attendees_count"], 1)

    def test_detail_without_images(self):
        occasion_data = self.client.get(f"/api/occasions/{self.plain.pk}/").json()
        self.assertIsNone(occasion_data["main_image"])
        self.assertEqual(occasion_data["gallery"], [])

    def test_detail_requires_login_and_a_real_occasion(self):
        self.assertEqual(self.client.get("/api/occasions/999999/").status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(f"/api/occasions/{self.occasion.pk}/").status_code, 403)

    def test_order_is_unique_and_capped_at_3(self):
        from django.core.files.base import ContentFile
        from django.db import IntegrityError

        from .models import OccasionImage

        for order in (0, 4):
            with self.assertRaises(IntegrityError), transaction.atomic():
                OccasionImage.objects.create(occasion=self.occasion, order=order, image=ContentFile(b"x", "a.png"))
