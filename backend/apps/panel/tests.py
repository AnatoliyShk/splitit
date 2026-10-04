from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.occasions.models import EMBEDDING_DIMENSIONS, Occasion
from apps.ai.embedding import embedding_updated
from apps.tags.models import Tag
from apps.users.models import User

PASSWORD = "correct-horse-battery"


# The tag list is cached; keep it out of the dev Redis and reset per test
@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class PanelTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user("admin@example.com", PASSWORD, name="Admin", is_staff=True)
        self.member = User.objects.create_user("member@example.com", PASSWORD, name="Member")
        self.client.force_login(self.admin)


class PermissionTests(PanelTestCase):
    urls = ("/api/panel/stats/", "/api/panel/users/", "/api/panel/occasions/", "/api/panel/tags/")

    def test_anonymous_is_rejected(self):
        self.client.logout()
        for url in self.urls:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)

    def test_non_staff_is_rejected(self):
        self.client.force_login(self.member)
        for url in self.urls:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)

    def test_me_exposes_staff_flag(self):
        self.assertTrue(self.client.get("/api/auth/me/").json()["user"]["is_staff"])


class StatsTests(PanelTestCase):
    def test_counts_users_and_upcoming_occasions(self):
        now = timezone.now()
        Occasion.objects.create(name="Past", start_datetime=now - timedelta(days=10))
        Occasion.objects.create(
            name="Ended", start_datetime=now - timedelta(hours=3), end_datetime=now - timedelta(hours=1)
        )
        running = Occasion.objects.create(
            name="Running", start_datetime=now - timedelta(hours=1), end_datetime=now + timedelta(hours=2)
        )
        running.users.add(self.member)
        Occasion.objects.create(name="Soon", start_datetime=now + timedelta(days=3))

        data = self.client.get("/api/panel/stats/").json()
        self.assertEqual(data["users"], {"total": 2, "active": 2, "staff": 1, "new_this_week": 2})
        self.assertEqual(data["occasions"], {"total": 4, "upcoming": 2})
        self.assertEqual([o["name"] for o in data["next_occasions"]], ["Running", "Soon"])
        self.assertEqual(data["next_occasions"][0]["attendees_count"], 1)


class UserManagementTests(PanelTestCase):
    def test_list_and_search(self):
        data = self.client.get("/api/panel/users/", {"search": "memb"}).json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["email"], "member@example.com")

    def test_toggle_access_flags(self):
        res = self.client.patch(
            f"/api/panel/users/{self.member.pk}/", {"is_staff": True, "is_active": False}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_staff)
        self.assertFalse(self.member.is_active)

    def test_profile_fields_are_read_only(self):
        self.client.patch(f"/api/panel/users/{self.member.pk}/", {"email": "x@example.com"}, format="json")
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, "member@example.com")

    def test_cannot_change_own_access(self):
        res = self.client.patch(f"/api/panel/users/{self.admin.pk}/", {"is_staff": False}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_staff_cannot_change_superuser(self):
        boss = User.objects.create_superuser("boss@example.com", PASSWORD, name="Boss")
        res = self.client.patch(f"/api/panel/users/{boss.pk}/", {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 403)


class OccasionManagementTests(PanelTestCase):
    def test_create_update_delete(self):
        res = self.client.post(
            "/api/panel/occasions/",
            {
                "name": "Trip",
                "start_datetime": "2026-10-10T18:00:00+03:00",
                "end_datetime": "2026-10-12T20:30:00+03:00",
                "users": [self.member.pk],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        occasion = res.json()
        self.assertEqual(occasion["start_datetime"], "2026-10-10T15:00:00Z")  # stored and returned in UTC
        self.assertEqual(occasion["duration_minutes"], 2 * 24 * 60 + 150)
        self.assertEqual(occasion["attendees"][0]["name"], "Member")

        res = self.client.patch(f"/api/panel/occasions/{occasion['id']}/", {"users": []}, format="json")
        self.assertEqual(res.json()["attendees"], [])

        res = self.client.delete(f"/api/panel/occasions/{occasion['id']}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Occasion.objects.exists())

    def test_end_not_after_start_is_rejected(self):
        for end in ("2026-10-10T17:00:00Z", "2026-10-10T18:00:00Z"):
            with self.subTest(end=end):
                res = self.client.post(
                    "/api/panel/occasions/",
                    {"name": "Bad", "start_datetime": "2026-10-10T18:00:00Z", "end_datetime": end},
                    format="json",
                )
                self.assertEqual(res.status_code, 400)
                self.assertIn("end_datetime", res.json())

    def test_partial_update_checks_end_against_stored_start(self):
        occasion = Occasion.objects.create(name="Trip", start_datetime="2026-10-10T18:00:00Z")
        res = self.client.patch(
            f"/api/panel/occasions/{occasion.pk}/", {"end_datetime": "2026-10-10T09:00:00Z"}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_open_ended_occasion_has_no_duration(self):
        res = self.client.post(
            "/api/panel/occasions/", {"name": "Open", "start_datetime": "2026-10-10T18:00:00Z"}, format="json"
        )
        self.assertIsNone(res.json()["duration_minutes"])

    def test_finish_running_occasion_ends_it_now(self):
        start = timezone.now() - timedelta(hours=1)
        occasion = Occasion.objects.create(name="Live", start_datetime=start, end_datetime=start + timedelta(hours=3))
        res = self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        self.assertEqual(res.status_code, 200)
        occasion.refresh_from_db()
        self.assertEqual(occasion.start_datetime, start)
        self.assertLessEqual(occasion.end_datetime, timezone.now())

    def test_finish_future_occasion_moves_it_to_end_now(self):
        start = timezone.now() + timedelta(days=2)
        occasion = Occasion.objects.create(name="Soon", start_datetime=start, end_datetime=start + timedelta(hours=2))
        self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        occasion.refresh_from_db()
        self.assertLessEqual(occasion.end_datetime, timezone.now())
        self.assertEqual(occasion.duration, timedelta(hours=2))

    def test_finish_open_ended_future_occasion_lasts_an_hour(self):
        occasion = Occasion.objects.create(name="Open", start_datetime=timezone.now() + timedelta(days=1))
        self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        occasion.refresh_from_db()
        self.assertEqual(occasion.duration, timedelta(hours=1))

    @override_settings(TASKS={"default": {"BACKEND": "django.tasks.backends.dummy.DummyBackend"}})
    def test_finish_queues_the_connections_count_straight_away(self):
        from django.tasks import default_task_backend

        default_task_backend.clear()
        occasion = Occasion.objects.create(name="Soon", start_datetime=timezone.now() + timedelta(days=1))
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        [job] = [r for r in default_task_backend.results if r.task.name == "apply_occasion_connections"]
        self.assertEqual(job.args, [occasion.pk])
        self.assertIsNone(job.task.run_after)

    def test_finish_ended_occasion_is_rejected(self):
        occasion = Occasion.objects.create(name="Past", start_datetime=timezone.now() - timedelta(days=1))
        res = self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("non_field_errors", res.json())

    def test_create_test_occasion_with_existing_users(self):
        res = self.client.post("/api/panel/occasions/test/")
        self.assertEqual(res.status_code, 201)
        occasion = Occasion.objects.get(pk=res.json()["id"])
        self.assertGreater(occasion.start_datetime, timezone.now())
        self.assertGreater(occasion.end_datetime, occasion.start_datetime)
        attendees = list(occasion.users.all())
        self.assertTrue(1 <= len(attendees) <= 3)
        # Staff are never picked; missing attendees are made up as test accounts
        self.assertNotIn(self.admin, attendees)
        self.assertIn(self.member, attendees)

    def test_create_test_occasion_creates_users_when_there_are_none(self):
        self.member.delete()
        res = self.client.post("/api/panel/occasions/test/")
        attendees = res.json()["attendees"]
        self.assertTrue(1 <= len(attendees) <= 3)
        created = User.objects.filter(email__startswith="test-")
        self.assertEqual(created.count(), len(attendees))
        self.assertFalse(any(u.has_usable_password() for u in created))

    def test_create_test_occasion_is_staff_only(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.post("/api/panel/occasions/test/").status_code, 403)
        self.assertFalse(Occasion.objects.exists())


class TagManagementTests(PanelTestCase):
    def test_list_is_sorted_case_insensitively_with_occasion_counts(self):
        jazz = Tag.objects.create(name="jazz")
        Tag.objects.create(name="Art")
        jazz.occasions.add(Occasion.objects.create(name="Gig", start_datetime=timezone.now()))
        data = self.client.get("/api/panel/tags/").json()
        self.assertEqual([(t["name"], t["occasions_count"]) for t in data["results"]], [("Art", 0), ("jazz", 1)])

    def test_create_rename_delete(self):
        res = self.client.post("/api/panel/tags/", {"name": "  Hiking "}, format="json")
        self.assertEqual(res.status_code, 201)
        tag = res.json()
        self.assertEqual((tag["name"], tag["occasions_count"]), ("Hiking", 0))

        res = self.client.patch(f"/api/panel/tags/{tag['id']}/", {"name": "Hikes"}, format="json")
        self.assertEqual(res.json()["name"], "Hikes")

        self.assertEqual(self.client.delete(f"/api/panel/tags/{tag['id']}/").status_code, 204)
        self.assertFalse(Tag.objects.exists())

    def test_list_shows_whether_each_tag_has_an_embedding(self):
        Tag.objects.create(name="Art", embedding=[1.0] * EMBEDDING_DIMENSIONS)
        Tag.objects.create(name="Jazz")
        data = self.client.get("/api/panel/tags/").json()
        self.assertEqual([(t["name"], t["has_embedding"]) for t in data["results"]], [("Art", True), ("Jazz", False)])

    def test_duplicate_name_is_rejected_case_insensitively(self):
        Tag.objects.create(name="Jazz")
        res = self.client.post("/api/panel/tags/", {"name": "JAZZ"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["name"], ["A tag with this name already exists."])

    def test_renaming_to_own_name_with_new_case_is_allowed(self):
        tag = Tag.objects.create(name="jazz")
        res = self.client.patch(f"/api/panel/tags/{tag.pk}/", {"name": "Jazz"}, format="json")
        self.assertEqual(res.status_code, 200)


class TagListCacheTests(PanelTestCase):
    def names(self, **params):
        return [t["name"] for t in self.client.get("/api/panel/tags/", params).json()["results"]]

    def row(self, name):
        return next(t for t in self.client.get("/api/panel/tags/").json()["results"] if t["name"] == name)

    def test_repeat_requests_are_served_from_cache(self):
        tag = Tag.objects.create(name="Jazz")
        self.assertEqual(self.names(), ["Jazz"])
        # update() sends no signals, so only a cache hit can still show the old name
        Tag.objects.filter(pk=tag.pk).update(name="Blues")
        self.assertEqual(self.names(), ["Jazz"])
        # Another search is its own entry; the same search in another case shares one
        self.assertEqual(self.names(search="blu"), ["Blues"])
        Tag.objects.filter(pk=tag.pk).update(name="Folk")
        self.assertEqual(self.names(search="BLU"), ["Blues"])

    def test_api_writes_show_in_the_next_list(self):
        self.assertEqual(self.names(), [])
        with self.captureOnCommitCallbacks(execute=True):
            tag = self.client.post("/api/panel/tags/", {"name": "Jazz"}, format="json").json()
        self.assertEqual(self.names(), ["Jazz"])
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f"/api/panel/tags/{tag['id']}/", {"name": "Blues"}, format="json")
        self.assertEqual(self.names(), ["Blues"])
        with self.captureOnCommitCallbacks(execute=True):
            self.client.delete(f"/api/panel/tags/{tag['id']}/")
        self.assertEqual(self.names(), [])

    def test_occasion_links_and_occasion_deletes_refresh_counts(self):
        tag = Tag.objects.create(name="Jazz")
        occasion = Occasion.objects.create(name="Gig", start_datetime=timezone.now())
        self.assertEqual(self.row("Jazz")["occasions_count"], 0)
        with self.captureOnCommitCallbacks(execute=True):
            tag.occasions.add(occasion)
        self.assertEqual(self.row("Jazz")["occasions_count"], 1)
        with self.captureOnCommitCallbacks(execute=True):
            occasion.delete()
        self.assertEqual(self.row("Jazz")["occasions_count"], 0)

    def test_embedding_updates_refresh_the_list(self):
        tag = Tag.objects.create(name="Jazz")
        self.assertFalse(self.row("Jazz")["has_embedding"])
        with self.captureOnCommitCallbacks(execute=True):
            Tag.objects.filter(pk=tag.pk).update(embedding=[1.0] * EMBEDDING_DIMENSIONS)
            embedding_updated.send(sender=Tag)
        self.assertTrue(self.row("Jazz")["has_embedding"])

    def test_cached_list_is_still_staff_only(self):
        Tag.objects.create(name="Jazz")
        self.assertEqual(self.names(), ["Jazz"])
        self.client.force_login(self.member)
        self.assertEqual(self.client.get("/api/panel/tags/").status_code, 403)
