from datetime import UTC, datetime, timedelta
from unittest import mock

from django.db import DataError, transaction
from django.tasks import default_task_backend
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from pgvector.django import CosineDistance

from .models import EMBEDDING_DIMENSIONS, Occasion, OccasionTemplate, OccasionUser
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

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana", adult_confirmed_at=timezone.now())
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben", adult_confirmed_at=timezone.now())
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

        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana", adult_confirmed_at=timezone.now())
        self.other = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben", adult_confirmed_at=timezone.now())
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

    def save_filters(self, tags=(), weekdays=(), is_enabled=True):
        from apps.users.models import FilterPreference, FilterPreferenceWeekday

        filter_preference = FilterPreference.objects.create(user=self.me, is_enabled=is_enabled)
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

    def test_filters_turned_off_show_everything(self):
        self.save_filters(weekdays=[self.sooner.start_datetime.isoweekday()], is_enabled=False)
        self.assertEqual(self.explore_names(), ["Running", "Sooner", "Later"])

    def test_names_the_attendees_i_have_a_connection_with(self):
        from apps.connections.models import Connection
        from apps.users.models import User

        # Pairs are stored smaller id first; Eve sits between Cleo and Finn, so she's on both sides
        cleo = User.objects.create_user("cleo@example.com", "correct-horse-battery", name="Cleo", adult_confirmed_at=timezone.now())
        eve = User.objects.create_user("eve@example.com", "correct-horse-battery", name="Eve", adult_confirmed_at=timezone.now())
        finn = User.objects.create_user("finn@example.com", "correct-horse-battery", name="Finn", adult_confirmed_at=timezone.now())
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

    def test_counts_attendees_by_gender(self):
        from apps.users.models import Gender, User

        ann = User.objects.create_user("ann@example.com", "correct-horse-battery", name="Ann", gender=Gender.WOMAN, adult_confirmed_at=timezone.now())
        bob = User.objects.create_user("bob@example.com", "correct-horse-battery", name="Bob", gender=Gender.MAN, adult_confirmed_at=timezone.now())
        cat = User.objects.create_user("cat@example.com", "correct-horse-battery", name="Cat", gender=Gender.WOMAN, adult_confirmed_at=timezone.now())
        self.later.users.add(self.other, ann, bob, cat)

        occasions = {occasion["name"]: occasion for occasion in self.explore()["occasions"]}
        # Ben (self.other) didn't say, so he counts as undisclosed
        self.assertEqual(occasions["Later"]["gender_counts"], {"man": 1, "woman": 2, "undisclosed": 1})
        self.assertEqual(occasions["Later"]["attendees_count"], 4)
        self.assertEqual(occasions["Sooner"]["gender_counts"], {"man": 0, "woman": 0, "undisclosed": 0})

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

        self.ana = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana", adult_confirmed_at=timezone.now())
        self.ben = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben", adult_confirmed_at=timezone.now())

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
        self.me = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana", adult_confirmed_at=timezone.now())
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


class UserOccasionTests(TestCase):
    """Occasions made by regular users (added from a link): who may see them."""

    def setUp(self):
        from apps.users.models import User

        self.ann = User.objects.create_user("ann@example.com", "correct-horse-battery", name="Ann", adult_confirmed_at=timezone.now())
        self.ben = User.objects.create_user("ben@example.com", "correct-horse-battery", name="Ben", adult_confirmed_at=timezone.now())
        self.cara = User.objects.create_user("cara@example.com", "correct-horse-battery", name="Cara", adult_confirmed_at=timezone.now())
        self.staff = User.objects.create_user("sam@example.com", "correct-horse-battery", name="Sam", is_staff=True, adult_confirmed_at=timezone.now())
        # Ann knows Ben, Ben knows Cara: Cara is only a friend of a friend to Ann
        self.connect(self.ann, self.ben)
        self.connect(self.ben, self.cara)
        self.start = timezone.now() + timedelta(days=3)

    def connect(self, first_user, second_user):
        from apps.connections.models import Connection

        user_low, user_high = sorted((first_user, second_user), key=lambda user: user.pk)
        Connection.objects.create(user_low=user_low, user_high=user_high, strength=1, shared_occasions=1)

    def make_occasion(self, **fields):
        occasion = Occasion.objects.create(name="Mine", start_datetime=self.start, created_by=self.ann, **fields)
        occasion.users.add(self.ann, self.ben)
        return occasion

    def test_creator_cancels_their_occasion_and_frees_attendees(self):
        from apps.occasions.models import OccasionUser

        occasion = self.make_occasion()
        self.client.force_login(self.ann)
        self.assertTrue(self.client.get(f"/api/occasions/{occasion.id}/").json()["is_mine"])
        response = self.client.post(f"/api/occasions/{occasion.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["cancelled_at"])
        occasion.refresh_from_db()
        self.assertIsNotNone(occasion.cancelled_at)
        self.assertFalse(OccasionUser.objects.filter(occasion=occasion, is_active=True).exists())
        # Cancelling twice is refused
        self.assertEqual(self.client.post(f"/api/occasions/{occasion.id}/cancel/").status_code, 400)

    def test_only_the_creator_cancels(self):
        occasion = self.make_occasion()
        staff_occasion = Occasion.objects.create(name="Staff", start_datetime=self.start, created_by=self.staff)
        self.client.force_login(self.ben)
        self.assertFalse(self.client.get(f"/api/occasions/{occasion.id}/").json()["is_mine"])
        self.assertEqual(self.client.post(f"/api/occasions/{occasion.id}/cancel/").status_code, 404)
        self.client.force_login(self.ann)
        self.assertEqual(self.client.post(f"/api/occasions/{staff_occasion.id}/cancel/").status_code, 404)
        occasion.refresh_from_db()
        self.assertIsNone(occasion.cancelled_at)

    def test_cannot_cancel_an_occasion_that_is_over(self):
        occasion = self.make_occasion()
        Occasion.objects.filter(pk=occasion.pk).update(start_datetime=timezone.now() - timedelta(days=2))
        self.client.force_login(self.ann)
        self.assertEqual(self.client.post(f"/api/occasions/{occasion.id}/cancel/").status_code, 400)

    def test_cancelling_needs_login(self):
        occasion = self.make_occasion()
        self.assertEqual(self.client.post(f"/api/occasions/{occasion.id}/cancel/").status_code, 403)

    def explore_names(self, user):
        self.client.force_login(user)
        return [occasion["name"] for occasion in self.client.get("/api/occasions/explore/").json()["occasions"]]

    def test_regular_users_cannot_create_one_directly(self):
        # Adding from a link (POST /api/occasions/import/) is the only way
        self.client.force_login(self.ann)
        request_data = {"name": "Picnic", "start_datetime": self.start.isoformat()}
        response = self.client.post("/api/occasions/", request_data, content_type="application/json")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(Occasion.objects.exists())

    def test_only_the_creator_and_direct_connections_see_it(self):
        picnic = Occasion.objects.create(name="Picnic", start_datetime=self.start, created_by=self.ann)
        # Ben is connected to Ann; Cara (a friend of a friend) and strangers aren't
        self.assertEqual(self.explore_names(self.ben), ["Picnic"])
        self.assertEqual(self.client.get(f"/api/occasions/{picnic.id}/").status_code, 200)
        self.assertEqual(self.explore_names(self.cara), [])
        self.assertEqual(self.client.get(f"/api/occasions/{picnic.id}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/occasions/{picnic.id}/join/").status_code, 404)
        self.assertEqual(self.explore_names(self.staff), [])

    def test_attendees_keep_seeing_it(self):
        picnic = Occasion.objects.create(name="Picnic", start_datetime=self.start, created_by=self.ann)
        picnic.users.add(self.cara)
        self.client.force_login(self.cara)
        self.assertEqual(self.client.get(f"/api/occasions/{picnic.id}/").status_code, 200)

    def test_staff_and_older_occasions_are_public_with_no_creator_shown(self):
        Occasion.objects.create(name="Gala", start_datetime=self.start, created_by=self.staff)
        Occasion.objects.create(name="Fair", start_datetime=self.start + timedelta(hours=1))
        Occasion.objects.create(name="Picnic", start_datetime=self.start + timedelta(hours=2), created_by=self.ann)
        self.client.force_login(self.ben)
        explore_occasions = self.client.get("/api/occasions/explore/").json()["occasions"]
        creator_by_name = {occasion["name"]: occasion["created_by"] for occasion in explore_occasions}
        self.assertEqual(
            creator_by_name, {"Gala": None, "Fair": None, "Picnic": {"uuid": str(self.ann.uuid), "name": "Ann"}}
        )
        self.assertEqual(self.explore_names(self.cara), ["Gala", "Fair"])


class PreviewCardTests(SimpleTestCase):
    def test_shows_the_title_subtitle_and_domain_escaped(self):
        from .preview import build_preview_svg

        card = build_preview_svg('Rock & "Roll" <Night>', "Bring <friends>", "example.com/events", "wave")
        self.assertTrue(card.startswith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"'))
        # The title wraps onto two lines here; each part is escaped
        self.assertIn(">Rock &amp; &quot;Roll&quot;</text>", card)
        self.assertIn(">&lt;Night&gt;</text>", card)
        self.assertIn("Bring &lt;friends&gt;", card)
        self.assertIn(">example.com/events</text>", card)
        self.assertNotIn("<Night>", card)
        # The wave theme's colours
        self.assertIn("#F0F9FF", card)

    def test_unknown_theme_falls_back_to_star(self):
        from .preview import THEMES, build_preview_svg

        self.assertIn(THEMES["star"]["bg"], build_preview_svg("Gig", icon="volcano"))

    def test_wraps_long_text_with_an_ellipsis(self):
        from .preview import wrap

        self.assertEqual(wrap("one two three", 7, 3), ["one two", "three"])
        lines = wrap("alpha beta gamma delta epsilon zeta", 11, 2)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[-1].endswith("…"))

    def test_link_domain_drops_www_and_the_trailing_slash(self):
        from .preview import link_domain

        self.assertEqual(link_domain("https://www.example.com/events/jazz/"), "example.com/events/jazz")
        self.assertEqual(link_domain("https://example.com/"), "example.com")
        self.assertEqual(len(link_domain("https://example.com/" + "a" * 80)), 48)


class ParseEventSummaryTests(SimpleTestCase):
    def parse(self, **summary):
        import json

        from .importing import parse_event_summary

        fields = {"title": "Jazz night", "start_date": "2030-05-01T19:00:00+03:00", **summary}
        return parse_event_summary(f"Here you go:\n```json\n{json.dumps(fields)}\n```")

    def test_takes_the_preview_theme_from_icon(self):
        self.assertEqual(self.parse(icon="Sakura")["theme"], "sakura")
        self.assertEqual(self.parse(icon="volcano")["theme"], "star")
        self.assertEqual(self.parse()["theme"], "star")

    def test_reads_the_fields_from_a_fenced_reply(self):
        event = self.parse(
            end_date="2030-05-01T22:30:00+03:00", description="  Two sets.  ", tags=["Jazz", "Live music"]
        )
        self.assertEqual(event["name"], "Jazz night")
        self.assertEqual(event["description"], "Two sets.")
        self.assertEqual(event["start_datetime"], datetime(2030, 5, 1, 16, 0, tzinfo=UTC))
        self.assertEqual(event["end_datetime"], datetime(2030, 5, 1, 19, 30, tzinfo=UTC))
        self.assertEqual(event["tag_names"], ["Jazz", "Live music"])

    def test_a_date_alone_is_midnight_and_no_offset_is_utc(self):
        self.assertEqual(self.parse(start_date="2030-05-01")["start_datetime"], datetime(2030, 5, 1, tzinfo=UTC))
        self.assertEqual(
            self.parse(start_date="2030-05-01T19:00:00")["start_datetime"], datetime(2030, 5, 1, 19, tzinfo=UTC)
        )

    def test_drops_an_end_that_is_not_after_the_start(self):
        self.assertIsNone(self.parse(end_date="2030-05-01T10:00:00+03:00")["end_datetime"])
        self.assertIsNone(self.parse(end_date="soon")["end_datetime"])

    def test_keeps_at_most_two_distinct_tags_within_the_name_limit(self):
        self.assertEqual(self.parse(tags=["Jazz", "jazz", "Food", "Art"])["tag_names"], ["Jazz", "Food"])
        self.assertEqual(self.parse(tags="Jazz")["tag_names"], ["Jazz"])
        self.assertEqual(len(self.parse(tags=["x" * 80])["tag_names"][0]), 50)

    def test_cuts_long_text_to_the_model_limits(self):
        event = self.parse(title="t" * 300, description="d" * 2500)
        self.assertEqual(len(event["name"]), 255)
        self.assertEqual(len(event["description"]), 2000)

    def test_rejects_replies_without_a_usable_event(self):
        from .importing import EventNotRead, parse_event_summary

        for reply in ("Sorry, I can't open that page.", "{not json}", '{"title": "Jazz"}', '{"start_date": "2030-05-01"}'):
            with self.subTest(reply=reply), self.assertRaises(EventNotRead):
                parse_event_summary(reply)


# The import throttle counts in the cache; keep it out of the dev Redis and reset per test
@override_settings(
    GEMINI_API_KEY="test-key", CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class ImportOccasionTests(TestCase):
    url = "https://example.com/events/jazz-night"

    def setUp(self):
        from apps.users.models import User

        import tempfile

        cache.clear()
        # The picture lands in a throwaway folder, never the dev media directory
        self.media = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(override_settings(MEDIA_ROOT=self.media))
        self.user = User.objects.create_user("ann@example.com", "correct-horse-battery", name="Ann", adult_confirmed_at=timezone.now())
        self.client.force_login(self.user)
        self.start = (timezone.now() + timedelta(days=10)).replace(microsecond=0)

    def reply(self, **summary):
        import json

        fields = {
            "title": "Jazz night",
            "start_date": self.start.isoformat(),
            "end_date": (self.start + timedelta(hours=3)).isoformat(),
            "description": "A trio on the rooftop.",
            "tags": ["jazz", "Live music"],
            "icon": "wave",
            **summary,
        }
        return f"```json\n{json.dumps(fields)}\n```"

    def post_import(self, reply=None, url=None, side_effect=None):
        with mock.patch("apps.occasions.importing.generate_text", return_value=reply, side_effect=side_effect) as gemini:
            response = self.client.post(
                "/api/occasions/import/", {"url": url or self.url}, content_type="application/json"
            )
        return response, gemini

    def test_creates_the_occasion_reusing_and_creating_tags(self):
        from apps.tags.models import Tag

        jazz_tag = Tag.objects.create(name="Jazz")
        response, gemini = self.post_import(self.reply())
        self.assertEqual(response.status_code, 201)

        # The link goes to Gemini inside the prompt, with leave to open it and to search the web for missing dates
        prompt = gemini.call_args.args[0]
        self.assertTrue(prompt.startswith(self.url))
        self.assertIn("Can you get summary of this event in format:", prompt)
        self.assertIn(f"today is {timezone.localdate().isoformat()}", prompt)
        self.assertEqual(gemini.call_args.kwargs, {"read_urls": True, "search_web": True})

        occasion_data = response.json()
        self.assertEqual(occasion_data["name"], "Jazz night")
        self.assertEqual(occasion_data["description"], "A trio on the rooftop.")
        self.assertEqual(sorted(occasion_data["tags"]), ["Jazz", "Live music"])
        self.assertTrue(occasion_data["is_going"])
        self.assertEqual(occasion_data["created_by"]["name"], "Ann")
        # "jazz" matched the existing tag; "Live music" was new
        self.assertEqual(Tag.objects.count(), 2)
        self.assertIn(jazz_tag, Occasion.objects.get(id=occasion_data["id"]).tags.all())

        # Its main image is a link-preview card: title, description, the link's domain, Gemini's theme
        self.assertTrue(occasion_data["main_image"].endswith(".svg"))
        main_image = Occasion.objects.get(id=occasion_data["id"]).images.get(order=0)
        with main_image.image.open("rb") as card_file:
            card = card_file.read().decode()
        for shown in (">Jazz night</text>", ">A trio on the rooftop.</text>", ">example.com/events/jazz-night</text>"):
            self.assertIn(shown, card)
        self.assertIn("#F0F9FF", card)

    def test_rejects_links_that_are_not_web_pages(self):
        for url in ("not a link", "ftp://example.com/event"):
            with self.subTest(url=url):
                response, gemini = self.post_import(self.reply(), url=url)
                self.assertEqual(response.status_code, 400)
                self.assertIn("url", response.json())
                gemini.assert_not_called()

    def test_refuses_without_asking_gemini_while_going_elsewhere(self):
        concert = Occasion.objects.create(name="Concert", start_datetime=self.start)
        concert.users.add(self.user)
        response, gemini = self.post_import(self.reply())
        self.assertEqual(response.status_code, 409)
        self.assertIn("Concert", response.json()["detail"])
        gemini.assert_not_called()

    @override_settings(GEMINI_API_KEY="")
    def test_needs_a_gemini_key(self):
        response, gemini = self.post_import(self.reply())
        self.assertEqual(response.status_code, 503)
        gemini.assert_not_called()

    def test_says_when_no_event_was_found(self):
        from apps.tags.models import Tag

        response, _ = self.post_import("I couldn't open that page.")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Couldn't find an event", response.json()["url"][0])
        self.assertFalse(Occasion.objects.exists())
        self.assertFalse(Tag.objects.exists())

    def test_uses_the_start_in_the_link_instead_of_the_one_in_the_reply(self):
        link_start = timezone.now().astimezone(UTC).replace(microsecond=0) + timedelta(days=30)
        reply = self.reply(start_date=(link_start + timedelta(days=5)).isoformat(), end_date=None)
        for param in ("start_at", "at"):
            Occasion.objects.all().delete()
            response, gemini = self.post_import(reply, url=f"https://example.com/e?{param}={link_start.isoformat()}")
            self.assertEqual(response.status_code, 201)
            self.assertEqual(Occasion.objects.get().start_datetime, link_start)
            self.assertIn(link_start.isoformat(), gemini.call_args.args[0])

    def test_reads_the_start_from_a_parameter_after_the_hash(self):
        today_midnight = timezone.now().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        reply = self.reply(start_date=(today_midnight - timedelta(days=9)).isoformat(), end_date=None)
        url = f"https://example.com/films/x#/buy-tickets?in-cinema=sofia&at={today_midnight.date().isoformat()}&view-mode=list"
        response, _ = self.post_import(reply, url=url)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Occasion.objects.get().start_datetime, today_midnight)

    def test_ignores_an_unreadable_start_in_the_link(self):
        reply_start = timezone.now().astimezone(UTC).replace(microsecond=0) + timedelta(days=3)
        response, gemini = self.post_import(self.reply(start_date=reply_start.isoformat(), end_date=None), url="https://example.com/e?start_at=soon")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Occasion.objects.get().start_datetime, reply_start)
        self.assertNotIn("already known", gemini.call_args.args[0])

    def test_accepts_an_event_that_starts_earlier_today(self):
        today_midnight = timezone.now().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        response, _ = self.post_import(self.reply(start_date=today_midnight.isoformat(), end_date=None))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Occasion.objects.get().start_datetime, today_midnight)

    def test_refuses_a_past_event_and_creates_no_tags(self):
        from apps.tags.models import Tag

        past_start = timezone.now() - timedelta(days=2)
        response, _ = self.post_import(self.reply(start_date=past_start.isoformat(), end_date=None))
        self.assertEqual(response.status_code, 400)
        self.assertIn("The start can't be before today.", response.json()["url"][0])
        self.assertFalse(Occasion.objects.exists())
        self.assertFalse(Tag.objects.exists())

    def test_reports_a_failed_gemini_call(self):
        with self.assertLogs("apps.occasions.importing", level="ERROR"):
            response, _ = self.post_import(side_effect=TimeoutError("timed out"))
        self.assertEqual(response.status_code, 502)
        self.assertFalse(Occasion.objects.exists())

    def test_requires_login(self):
        self.client.logout()
        response, gemini = self.post_import(self.reply())
        self.assertEqual(response.status_code, 403)
        gemini.assert_not_called()


class OccasionTemplateApiTests(TestCase):
    def setUp(self):
        from apps.tags.models import Tag
        from apps.users.models import User

        self.user = User.objects.create_user(
            "ann@example.com", "correct-horse-battery", name="Ann", adult_confirmed_at=timezone.now()
        )
        self.jazz_tag = Tag.objects.create(name="Jazz")
        self.template = OccasionTemplate.objects.create(
            name="Jazz night", description="A trio.", duration_minutes=180
        )
        self.template.tags.add(self.jazz_tag)
        self.client.force_login(self.user)
        self.start = (timezone.now() + timedelta(days=3)).replace(microsecond=0)

    def create_occasion(self, start=None, template=None):
        return self.client.post(
            f"/api/occasion-templates/{(template or self.template).pk}/occasions/",
            {"start_datetime": (start or self.start).isoformat()},
            format="json",
        )

    def test_lists_templates_by_name(self):
        OccasionTemplate.objects.create(name="Board games")
        template_names = [template["name"] for template in self.client.get("/api/occasion-templates/").json()]
        self.assertEqual(template_names, ["Board games", "Jazz night"])
        jazz = self.client.get("/api/occasion-templates/").json()[1]
        self.assertEqual(
            jazz,
            {
                "id": self.template.pk,
                "name": "Jazz night",
                "description": "A trio.",
                "duration_minutes": 180,
                "tags": ["Jazz"],
                "main_image": None,
            },
        )

    def test_listing_needs_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/occasion-templates/").status_code, 403)

    def test_creates_an_occasion_the_user_goes_to(self):
        response = self.create_occasion()
        self.assertEqual(response.status_code, 201)
        occasion = Occasion.objects.get(pk=response.json()["id"])
        self.assertEqual(occasion.name, "Jazz night")
        self.assertEqual(occasion.description, "A trio.")
        self.assertEqual(occasion.start_datetime, self.start)
        self.assertEqual(occasion.end_datetime, self.start + timedelta(minutes=180))
        self.assertEqual(occasion.created_by, self.user)
        self.assertEqual(list(occasion.tags.all()), [self.jazz_tag])
        self.assertEqual(list(occasion.users.all()), [self.user])
        self.assertTrue(response.json()["is_mine"])

    def test_a_template_without_a_duration_makes_an_open_ended_occasion(self):
        template = OccasionTemplate.objects.create(name="Hangout")
        response = self.create_occasion(template=template)
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(Occasion.objects.get(pk=response.json()["id"]).end_datetime)

    def test_the_start_must_be_in_the_future(self):
        response = self.create_occasion(start=timezone.now() - timedelta(hours=1))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["start_datetime"], ["The start must be in the future."])
        self.assertFalse(Occasion.objects.exists())

    def test_a_missing_start_is_rejected(self):
        response = self.client.post(f"/api/occasion-templates/{self.template.pk}/occasions/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("start_datetime", response.json())

    def test_refused_while_going_to_another_occasion(self):
        self.assertEqual(self.create_occasion().status_code, 201)
        response = self.create_occasion(start=self.start + timedelta(days=1))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Occasion.objects.count(), 1)

    def test_unknown_template_is_404(self):
        response = self.client.post(
            "/api/occasion-templates/9999/occasions/", {"start_datetime": self.start.isoformat()}, format="json"
        )
        self.assertEqual(response.status_code, 404)


class OccasionTemplateImagesTests(TestCase):
    def setUp(self):
        import tempfile

        from django.core.files.base import ContentFile

        from apps.users.models import User

        self.media = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(override_settings(MEDIA_ROOT=self.media))
        self.user = User.objects.create_user(
            "ann@example.com", "correct-horse-battery", name="Ann", adult_confirmed_at=timezone.now()
        )
        self.template = OccasionTemplate.objects.create(name="Jazz night", duration_minutes=60)
        self.template.images.create(order=0, image=ContentFile(b"main", "main.png"))
        self.template.images.create(order=2, image=ContentFile(b"gallery", "gallery.png"))
        self.client.force_login(self.user)
        self.start = (timezone.now() + timedelta(days=3)).replace(microsecond=0)

    def stored_files(self):
        from pathlib import Path

        return sorted(str(path.relative_to(self.media)) for path in Path(self.media).rglob("*") if path.is_file())

    def create_occasion(self):
        return self.client.post(
            f"/api/occasion-templates/{self.template.pk}/occasions/",
            {"start_datetime": self.start.isoformat()},
            format="json",
        )

    def test_the_list_carries_each_templates_main_image(self):
        [template_data] = self.client.get("/api/occasion-templates/").json()
        self.assertRegex(template_data["main_image"], rf"^/media/occasion_templates/{self.template.pk}/\w+\.png$")

    def test_a_template_without_images_has_no_main_image(self):
        self.template.images.all().delete()
        [template_data] = self.client.get("/api/occasion-templates/").json()
        self.assertIsNone(template_data["main_image"])

    def test_the_occasion_gets_a_copy_of_every_image_in_its_slot(self):
        response = self.create_occasion()
        self.assertEqual(response.status_code, 201)
        occasion = Occasion.objects.get(pk=response.json()["id"])
        self.assertEqual(list(occasion.images.values_list("order", flat=True)), [0, 2])
        with occasion.images.get(order=0).image.open("rb") as main_file:
            self.assertEqual(main_file.read(), b"main")
        # The detail shows the copied main image and gallery
        self.assertRegex(response.json()["main_image"], rf"^/media/occasions/{occasion.pk}/\w+\.png$")
        self.assertEqual(len(response.json()["gallery"]), 1)
        # Four files: the template's two and the occasion's two
        self.assertEqual(len(self.stored_files()), 4)

    def test_deleting_the_occasion_keeps_the_templates_files(self):
        occasion = Occasion.objects.get(pk=self.create_occasion().json()["id"])
        with self.captureOnCommitCallbacks(execute=True):
            occasion.delete()
        self.assertEqual(len(self.stored_files()), 2)
        self.assertTrue(all(name.startswith("occasion_templates/") for name in self.stored_files()))

    def test_deleting_the_template_keeps_the_occasions_files(self):
        occasion = Occasion.objects.get(pk=self.create_occasion().json()["id"])
        with self.captureOnCommitCallbacks(execute=True):
            self.template.delete()
        self.assertEqual(len(self.stored_files()), 2)
        with occasion.images.get(order=0).image.open("rb") as main_file:
            self.assertEqual(main_file.read(), b"main")

    def test_a_missing_file_is_skipped_instead_of_failing(self):
        from pathlib import Path

        Path(self.media, self.template.images.get(order=2).image.name).unlink()
        response = self.create_occasion()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            list(Occasion.objects.get(pk=response.json()["id"]).images.values_list("order", flat=True)), [0]
        )

    def test_a_refused_occasion_copies_nothing(self):
        self.assertEqual(self.create_occasion().status_code, 201)
        files_before = self.stored_files()
        self.start += timedelta(days=1)
        self.assertEqual(self.create_occasion().status_code, 409)
        self.assertEqual(self.stored_files(), files_before)
