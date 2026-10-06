from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.occasions.models import EMBEDDING_DIMENSIONS, Occasion, OccasionUser
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

        stats = self.client.get("/api/panel/stats/").json()
        self.assertEqual(stats["users"], {"total": 2, "active": 2, "staff": 1, "new_this_week": 2})
        self.assertEqual(stats["occasions"], {"total": 4, "upcoming": 2})
        self.assertEqual([occasion["name"] for occasion in stats["next_occasions"]], ["Running", "Soon"])
        self.assertEqual(stats["next_occasions"][0]["attendees_count"], 1)


class UserManagementTests(PanelTestCase):
    def test_list_and_search(self):
        users_page = self.client.get("/api/panel/users/", {"search": "memb"}).json()
        self.assertEqual(users_page["count"], 1)
        self.assertEqual(users_page["results"][0]["email"], "member@example.com")

    def test_toggle_access_flags(self):
        response = self.client.patch(
            f"/api/panel/users/{self.member.pk}/", {"is_staff": True, "is_active": False}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_staff)
        self.assertFalse(self.member.is_active)

    def test_profile_fields_are_read_only(self):
        self.client.patch(f"/api/panel/users/{self.member.pk}/", {"email": "x@example.com"}, format="json")
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, "member@example.com")

    def test_cannot_change_own_access(self):
        response = self.client.patch(f"/api/panel/users/{self.admin.pk}/", {"is_staff": False}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_staff_cannot_change_superuser(self):
        boss = User.objects.create_superuser("boss@example.com", PASSWORD, name="Boss")
        response = self.client.patch(f"/api/panel/users/{boss.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 403)


class OccasionManagementTests(PanelTestCase):
    def test_create_update_delete(self):
        response = self.client.post(
            "/api/panel/occasions/",
            {
                "name": "Trip",
                "start_datetime": "2026-10-10T18:00:00+03:00",
                "end_datetime": "2026-10-12T20:30:00+03:00",
                "users": [self.member.pk],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        occasion = response.json()
        self.assertEqual(occasion["start_datetime"], "2026-10-10T15:00:00Z")  # stored and returned in UTC
        self.assertEqual(occasion["duration_minutes"], 2 * 24 * 60 + 150)
        self.assertEqual(occasion["attendees"][0]["name"], "Member")

        response = self.client.patch(f"/api/panel/occasions/{occasion['id']}/", {"users": []}, format="json")
        self.assertEqual(response.json()["attendees"], [])

        response = self.client.delete(f"/api/panel/occasions/{occasion['id']}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Occasion.objects.exists())

    def test_tags_are_set_by_id_and_read_back_with_names(self):
        jazz, blues = Tag.objects.create(name="jazz"), Tag.objects.create(name="Blues")
        response = self.client.post(
            "/api/panel/occasions/",
            {"name": "Gig", "start_datetime": "2026-10-10T18:00:00Z", "tag_ids": [jazz.pk, blues.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        occasion = response.json()
        self.assertNotIn("tag_ids", occasion)
        # Sorted case-insensitively, like the tag list
        self.assertEqual(occasion["tags"], [{"id": blues.pk, "name": "Blues"}, {"id": jazz.pk, "name": "jazz"}])

        response = self.client.patch(f"/api/panel/occasions/{occasion['id']}/", {"tag_ids": [jazz.pk]}, format="json")
        self.assertEqual(response.json()["tags"], [{"id": jazz.pk, "name": "jazz"}])
        # Leaving tag_ids out keeps them
        response = self.client.patch(f"/api/panel/occasions/{occasion['id']}/", {"name": "Gig 2"}, format="json")
        self.assertEqual(response.json()["tags"], [{"id": jazz.pk, "name": "jazz"}])

    def test_unknown_tag_is_rejected(self):
        response = self.client.post(
            "/api/panel/occasions/",
            {"name": "Gig", "start_datetime": "2026-10-10T18:00:00Z", "tag_ids": [999]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("tag_ids", response.json())

    def test_end_not_after_start_is_rejected(self):
        for end in ("2026-10-10T17:00:00Z", "2026-10-10T18:00:00Z"):
            with self.subTest(end=end):
                response = self.client.post(
                    "/api/panel/occasions/",
                    {"name": "Bad", "start_datetime": "2026-10-10T18:00:00Z", "end_datetime": end},
                    format="json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("end_datetime", response.json())

    def test_partial_update_checks_end_against_stored_start(self):
        occasion = Occasion.objects.create(name="Trip", start_datetime="2026-10-10T18:00:00Z")
        response = self.client.patch(
            f"/api/panel/occasions/{occasion.pk}/", {"end_datetime": "2026-10-10T09:00:00Z"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_open_ended_occasion_has_no_duration(self):
        response = self.client.post(
            "/api/panel/occasions/", {"name": "Open", "start_datetime": "2026-10-10T18:00:00Z"}, format="json"
        )
        self.assertIsNone(response.json()["duration_minutes"])

    def test_finish_running_occasion_ends_it_now(self):
        start = timezone.now() - timedelta(hours=1)
        occasion = Occasion.objects.create(name="Live", start_datetime=start, end_datetime=start + timedelta(hours=3))
        response = self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        self.assertEqual(response.status_code, 200)
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
        [job] = [
            task_result
            for task_result in default_task_backend.results
            if task_result.task.name == "apply_occasion_connections"
        ]
        self.assertEqual(job.args, [occasion.pk])
        self.assertIsNone(job.task.run_after)

    def test_finish_ended_occasion_is_rejected(self):
        occasion = Occasion.objects.create(name="Past", start_datetime=timezone.now() - timedelta(days=1))
        response = self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("non_field_errors", response.json())

    def test_finish_frees_its_attendees_straight_away(self):
        occasion = Occasion.objects.create(name="Soon", start_datetime=timezone.now() + timedelta(days=1))
        occasion.users.add(self.member)
        self.client.post(f"/api/panel/occasions/{occasion.pk}/finish/")
        self.assertFalse(OccasionUser.objects.get(occasion=occasion, user=self.member).is_active)

    def test_cancel_marks_it_cancelled_and_frees_its_attendees(self):
        occasion = Occasion.objects.create(name="Soon", start_datetime=timezone.now() + timedelta(days=1))
        occasion.users.add(self.member)
        response = self.client.post(f"/api/panel/occasions/{occasion.pk}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["cancelled_at"])
        self.assertFalse(OccasionUser.objects.get(occasion=occasion, user=self.member).is_active)
        # Still listed, with its attendees, but no longer upcoming
        self.assertEqual(response.json()["attendees"][0]["id"], self.member.pk)
        self.assertEqual(self.client.get("/api/panel/stats/").json()["occasions"]["upcoming"], 0)

    def test_cancel_or_finish_twice_is_rejected(self):
        occasion = Occasion.objects.create(name="Soon", start_datetime=timezone.now() + timedelta(days=1))
        self.client.post(f"/api/panel/occasions/{occasion.pk}/cancel/")
        for action in ("cancel", "finish"):
            response = self.client.post(f"/api/panel/occasions/{occasion.pk}/{action}/")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["non_field_errors"], ["This occasion was cancelled."])

    def test_cancel_ended_occasion_is_rejected(self):
        occasion = Occasion.objects.create(name="Past", start_datetime=timezone.now() - timedelta(days=1))
        response = self.client.post(f"/api/panel/occasions/{occasion.pk}/cancel/")
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(Occasion.objects.get(pk=occasion.pk).cancelled_at)

    def test_cancel_is_staff_only(self):
        occasion = Occasion.objects.create(name="Soon", start_datetime=timezone.now() + timedelta(days=1))
        self.client.force_login(self.member)
        self.assertEqual(self.client.post(f"/api/panel/occasions/{occasion.pk}/cancel/").status_code, 403)

    def test_create_test_occasion_with_existing_users(self):
        response = self.client.post("/api/panel/occasions/test/")
        self.assertEqual(response.status_code, 201)
        occasion = Occasion.objects.get(pk=response.json()["id"])
        self.assertGreater(occasion.start_datetime, timezone.now())
        self.assertGreater(occasion.end_datetime, occasion.start_datetime)
        attendees = list(occasion.users.all())
        self.assertTrue(1 <= len(attendees) <= 3)
        # Staff are never picked; missing attendees are made up as test accounts
        self.assertNotIn(self.admin, attendees)
        self.assertIn(self.member, attendees)

    def test_create_test_occasion_creates_users_when_there_are_none(self):
        self.member.delete()
        response = self.client.post("/api/panel/occasions/test/")
        attendees = response.json()["attendees"]
        self.assertTrue(1 <= len(attendees) <= 3)
        created = User.objects.filter(email__startswith="test-")
        self.assertEqual(created.count(), len(attendees))
        self.assertFalse(any(user.has_usable_password() for user in created))

    def test_create_test_occasion_is_staff_only(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.post("/api/panel/occasions/test/").status_code, 403)
        self.assertFalse(Occasion.objects.exists())


class TagManagementTests(PanelTestCase):
    def test_list_is_sorted_case_insensitively_with_occasion_counts(self):
        jazz = Tag.objects.create(name="jazz")
        Tag.objects.create(name="Art")
        jazz.occasions.add(Occasion.objects.create(name="Gig", start_datetime=timezone.now()))
        tags_page = self.client.get("/api/panel/tags/").json()
        tag_counts = [(tag["name"], tag["occasions_count"]) for tag in tags_page["results"]]
        self.assertEqual(tag_counts, [("Art", 0), ("jazz", 1)])

    def test_create_rename_delete(self):
        response = self.client.post("/api/panel/tags/", {"name": "  Hiking "}, format="json")
        self.assertEqual(response.status_code, 201)
        tag = response.json()
        self.assertEqual((tag["name"], tag["occasions_count"]), ("Hiking", 0))

        response = self.client.patch(f"/api/panel/tags/{tag['id']}/", {"name": "Hikes"}, format="json")
        self.assertEqual(response.json()["name"], "Hikes")

        self.assertEqual(self.client.delete(f"/api/panel/tags/{tag['id']}/").status_code, 204)
        self.assertFalse(Tag.objects.exists())

    def test_list_shows_whether_each_tag_has_an_embedding(self):
        Tag.objects.create(name="Art", embedding=[1.0] * EMBEDDING_DIMENSIONS)
        Tag.objects.create(name="Jazz")
        tags_page = self.client.get("/api/panel/tags/").json()
        tag_embeddings = [(tag["name"], tag["has_embedding"]) for tag in tags_page["results"]]
        self.assertEqual(tag_embeddings, [("Art", True), ("Jazz", False)])

    def test_duplicate_name_is_rejected_case_insensitively(self):
        Tag.objects.create(name="Jazz")
        response = self.client.post("/api/panel/tags/", {"name": "JAZZ"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["name"], ["A tag with this name already exists."])

    def test_renaming_to_own_name_with_new_case_is_allowed(self):
        tag = Tag.objects.create(name="jazz")
        response = self.client.patch(f"/api/panel/tags/{tag.pk}/", {"name": "Jazz"}, format="json")
        self.assertEqual(response.status_code, 200)


class TagListCacheTests(PanelTestCase):
    def names(self, **params):
        return [tag["name"] for tag in self.client.get("/api/panel/tags/", params).json()["results"]]

    def row(self, name):
        return next(tag for tag in self.client.get("/api/panel/tags/").json()["results"] if tag["name"] == name)

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


def image_file(name="photo.png", fmt="PNG", size=(4, 3)):
    """A tiny real image, as an upload."""
    from io import BytesIO

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", size, "yellow").save(buffer, fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


class OccasionImageTests(PanelTestCase):
    def setUp(self):
        import tempfile

        super().setUp()
        # Uploads land in a throwaway folder, never the dev media directory
        self.media = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(override_settings(MEDIA_ROOT=self.media))
        self.occasion = Occasion.objects.create(name="Gig", start_datetime=timezone.now() + timedelta(days=1))
        self.url = f"/api/panel/occasions/{self.occasion.pk}/images/"

    def upload(self, order, file=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(self.url, {"order": order, "image": file or image_file()}, format="multipart")

    def stored_files(self):
        from pathlib import Path

        return sorted(path.name for path in Path(self.media).rglob("*") if path.is_file())

    def test_upload_fills_a_slot_and_returns_the_images(self):
        response = self.upload(0)
        self.assertEqual(response.status_code, 201)
        [image] = response.json()["images"]
        self.assertEqual(image["order"], 0)
        self.assertRegex(image["url"], rf"^/media/occasions/{self.occasion.pk}/[0-9a-f]{{32}}\.png$")
        self.assertEqual(len(self.stored_files()), 1)

    def test_images_come_back_in_order(self):
        for order in (2, 0, 1):
            self.upload(order)
        occasion_data = self.client.get(f"/api/panel/occasions/{self.occasion.pk}/").json()
        self.assertEqual([image["order"] for image in occasion_data["images"]], [0, 1, 2])

    def test_uploading_to_a_taken_slot_replaces_the_image_and_its_file(self):
        first = self.upload(1).json()["images"][0]["url"]
        second = self.upload(1).json()["images"]
        self.assertEqual(len(second), 1)
        self.assertNotEqual(second[0]["url"], first)
        self.assertEqual(self.stored_files(), [second[0]["url"].rsplit("/", 1)[1]])

    def test_delete_empties_the_slot_and_removes_the_file(self):
        self.upload(0)
        self.upload(3)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete(f"{self.url}3/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([image["order"] for image in response.json()["images"]], [0])
        self.assertEqual(len(self.stored_files()), 1)
        self.assertEqual(self.client.delete(f"{self.url}3/").status_code, 404)

    def test_deleting_the_occasion_removes_its_files(self):
        self.upload(0)
        self.upload(1)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.delete(f"/api/panel/occasions/{self.occasion.pk}/")
        self.assertEqual(self.stored_files(), [])

    def test_order_must_be_a_slot_from_0_to_3(self):
        for order in (-1, 4):
            response = self.upload(order)
            self.assertEqual(response.status_code, 400)
            self.assertIn("order", response.json())
        self.assertEqual(self.stored_files(), [])

    def test_rejects_files_that_are_not_web_images(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.upload(0, SimpleUploadedFile("notes.png", b"not an image", content_type="image/png"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.json())
        response = self.upload(0, image_file("photo.gif", "GIF"))
        self.assertEqual(response.json()["image"], ["Use a JPEG, PNG or WebP image."])

    def test_rejects_images_over_5_mb(self):
        from apps.panel import serializers

        original = serializers.MAX_IMAGE_BYTES
        serializers.MAX_IMAGE_BYTES = 10
        try:
            response = self.upload(0)
        finally:
            serializers.MAX_IMAGE_BYTES = original
        self.assertEqual(response.json()["image"], ["The image must be 5 MB or smaller."])

    def test_images_are_staff_only(self):
        self.client.force_login(self.member)
        self.assertEqual(self.upload(0).status_code, 403)
        self.assertEqual(self.client.delete(f"{self.url}0/").status_code, 403)
