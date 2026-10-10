from datetime import timedelta

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from apps.tags.models import Tag

from .models import User, FilterPreference, FilterPreferenceWeekday, Weekday

PASSWORD = "correct-horse-battery"


# Throttle counters live in the cache; keep them out of the dev Redis and reset per test
@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class AuthApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf_post(self, url, request_data=None):
        self.client.get("/api/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        return self.client.post(url, request_data or {}, format="json", HTTP_X_CSRFTOKEN=token)

    def me(self):
        return self.client.get("/api/auth/me/").json()["user"]

    def test_me_is_null_when_logged_out(self):
        self.assertIsNone(self.me())

    def test_register_creates_user_and_logs_in(self):
        response = self.csrf_post(
            "/api/auth/register/",
            {"email": "Ana@Example.com", "name": "Ana", "password": PASSWORD, "is_adult": True},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["email"], "ana@example.com")
        self.assertEqual(self.me()["name"], "Ana")
        # The declaration is recorded with the account
        self.assertIsNotNone(response.json()["user"]["adult_confirmed_at"])
        self.assertIsNotNone(User.objects.get().adult_confirmed_at)

    def test_register_takes_a_gender_and_defaults_to_undisclosed(self):
        details = {"email": "ana@example.com", "name": "Ana", "password": PASSWORD, "is_adult": True}
        response = self.csrf_post("/api/auth/register/", {**details, "gender": "woman"})
        self.assertEqual(response.json()["user"]["gender"], "woman")
        User.objects.all().delete()
        response = self.csrf_post("/api/auth/register/", details)
        self.assertEqual(response.json()["user"]["gender"], "undisclosed")

    def test_register_refuses_without_the_18_plus_declaration(self):
        details = {"email": "ana@example.com", "name": "Ana", "password": PASSWORD}
        refusals = (
            (None, "Confirm that you're 18 or older."),
            (False, "Splitit is only for people aged 18 or older."),
        )
        for is_adult, message in refusals:
            request_data = details if is_adult is None else {**details, "is_adult": is_adult}
            response = self.csrf_post("/api/auth/register/", request_data)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["is_adult"], [message])
        self.assertFalse(User.objects.exists())
        self.assertIsNone(self.me())

    def test_register_rejects_duplicate_email_case_insensitively(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        response = self.csrf_post(
            "/api/auth/register/",
            {"email": "ANA@example.com", "name": "Ana 2", "password": PASSWORD},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.json())

    def test_register_rejects_weak_password(self):
        response = self.csrf_post(
            "/api/auth/register/",
            {"email": "ana@example.com", "name": "Ana", "password": "123", "is_adult": True},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())
        self.assertFalse(User.objects.exists())

    def test_login_and_logout(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        response = self.csrf_post("/api/auth/login/", {"email": "ANA@example.com", "password": PASSWORD})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.me()["email"], "ana@example.com")

        response = self.csrf_post("/api/auth/logout/")
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(self.me())

    def test_login_rejects_wrong_password(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        response = self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["non_field_errors"], ["Email or password is incorrect."])
        self.assertIsNone(self.me())

    def test_login_requires_csrf_token(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        response = self.client.post(
            "/api/auth/login/", {"email": "ana@example.com", "password": PASSWORD}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_login_is_rate_limited(self):
        for _ in range(10):
            self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        response = self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        self.assertEqual(response.status_code, 429)


class AdultConfirmationTests(APITestCase):
    """Accounts made before sign-up asked for the 18+ declaration: blocked from the API until they make it."""

    def setUp(self):
        from apps.occasions.models import Occasion

        self.unconfirmed = User.objects.create_user("old@example.com", PASSWORD, name="Old")
        self.client.force_login(self.unconfirmed)
        self.occasion = Occasion.objects.create(
            name="Mine", start_datetime=timezone.now() + timedelta(days=2), created_by=self.unconfirmed
        )

    def test_api_is_blocked_until_confirmed(self):
        for url in ("/api/occasions/explore/", "/api/tags/", f"/api/users/{self.unconfirmed.uuid}/occasions/"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 403, url)
            self.assertEqual(response.json()["code"], "age_confirmation_required")
        # The session check and the health check still answer, so the app can show the confirmation screen
        self.assertIsNone(self.client.get("/api/auth/me/").json()["user"]["adult_confirmed_at"])
        self.assertEqual(self.client.get("/api/health/").status_code, 200)

    def test_staff_are_blocked_too(self):
        staff = User.objects.create_user("staff@example.com", PASSWORD, name="Staff", is_staff=True)
        self.client.force_login(staff)
        self.assertEqual(self.client.get("/api/admin/stats/").status_code, 403)

    def test_confirming_records_the_time_and_unblocks(self):
        response = self.client.post("/api/auth/age/", {"is_adult": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["user"]["adult_confirmed_at"])
        confirmed_at = User.objects.get(pk=self.unconfirmed.pk).adult_confirmed_at
        self.assertIsNotNone(confirmed_at)
        self.assertEqual(self.client.get("/api/occasions/explore/").status_code, 200)
        # Confirming again keeps the first record
        self.client.post("/api/auth/age/", {"is_adult": True}, format="json")
        self.assertEqual(User.objects.get(pk=self.unconfirmed.pk).adult_confirmed_at, confirmed_at)

    def test_declaring_under_18_deletes_the_account_and_logs_out(self):
        from apps.occasions.models import Occasion

        response = self.client.post("/api/auth/age/", {"is_adult": False}, format="json")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.unconfirmed.pk).exists())
        self.assertFalse(Occasion.objects.filter(pk=self.occasion.pk).exists())
        self.assertIsNone(self.client.get("/api/auth/me/").json()["user"])

    def test_the_declaration_is_required(self):
        response = self.client.post("/api/auth/age/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["is_adult"], ["Confirm that you're 18 or older."])

    def test_confirming_needs_login(self):
        self.client.logout()
        self.assertEqual(self.client.post("/api/auth/age/", {"is_adult": True}, format="json").status_code, 403)


class UserAdminTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin@example.com", PASSWORD, name="Admin", adult_confirmed_at=timezone.now())
        self.client.force_login(self.admin)

    def test_admin_pages_render(self):
        change_url = f"/django-admin/users/user/{self.admin.pk}/change/"
        for url in ("/django-admin/users/user/", "/django-admin/users/user/add/", change_url):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_admin_creates_user_with_email(self):
        self.client.post(
            "/django-admin/users/user/add/",
            {
                "email": "New@Example.com",
                "name": "New",
                "usable_password": "true",
                "password1": PASSWORD,
                "password2": PASSWORD,
            },
        )
        self.assertTrue(User.objects.get(email="new@example.com").check_password(PASSWORD))


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class ProfileApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("ana@example.com", PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.user)

    def csrf(self, method, url, request_data):
        self.client.get("/api/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        return getattr(self.client, method)(url, request_data, format="json", HTTP_X_CSRFTOKEN=token)

    def test_me_includes_join_date(self):
        self.assertIn("date_joined", self.client.get("/api/auth/me/").json()["user"])

    def test_update_name(self):
        response = self.csrf("patch", "/api/auth/me/", {"name": "  Ana Petrova "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["name"], "Ana Petrova")

    def test_gender_defaults_to_undisclosed_and_can_be_changed(self):
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["gender"], "undisclosed")
        response = self.csrf("patch", "/api/auth/me/", {"gender": "woman"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["gender"], "woman")
        self.user.refresh_from_db()
        self.assertEqual(self.user.gender, "woman")

    def test_unknown_gender_is_rejected(self):
        response = self.csrf("patch", "/api/auth/me/", {"gender": "robot"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("gender", response.json())

    def test_blank_name_is_rejected(self):
        response = self.csrf("patch", "/api/auth/me/", {"name": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["name"], ["Enter your name."])

    def test_cannot_change_email_or_access(self):
        self.csrf("patch", "/api/auth/me/", {"email": "x@example.com", "is_staff": True})
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "ana@example.com")
        self.assertFalse(self.user.is_staff)

    def test_update_requires_login(self):
        self.client.logout()
        self.assertEqual(self.csrf("patch", "/api/auth/me/", {"name": "X"}).status_code, 403)

    def test_change_password_keeps_session(self):
        new = "another-strong-pass-42"
        response = self.csrf("post", "/api/auth/password/", {"current_password": PASSWORD, "new_password": new})
        self.assertEqual(response.status_code, 204)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new))
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["email"], "ana@example.com")

    def test_change_password_checks_current_and_strength(self):
        response = self.csrf("post", "/api/auth/password/", {"current_password": "nope", "new_password": "123"})
        self.assertEqual(response.status_code, 400)
        errors = response.json()
        self.assertEqual(errors["current_password"], ["Your current password is incorrect."])
        self.assertIn("new_password", errors)


class UserUuidTests(APITestCase):
    def test_users_get_distinct_time_ordered_uuid7s(self):
        first = User.objects.create_user("a@example.com", PASSWORD, name="A", adult_confirmed_at=timezone.now())
        second = User.objects.create_user("b@example.com", PASSWORD, name="B", adult_confirmed_at=timezone.now())
        self.assertEqual((first.uuid.version, second.uuid.version), (7, 7))
        self.assertLess(first.uuid, second.uuid)

    def test_me_exposes_uuid(self):
        user = User.objects.create_user("a@example.com", PASSWORD, name="A", adult_confirmed_at=timezone.now())
        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["uuid"], str(user.uuid))


class FilterPreferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="ana@example.com", password=PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        self.filter_preference = FilterPreference.objects.create(user=self.user)

    def test_one_filter_preference_per_user(self):
        with self.assertRaises(IntegrityError):
            FilterPreference.objects.create(user=self.user)

    def test_stores_tags_and_weekdays(self):
        jazz_tag = Tag.objects.create(name="Jazz")
        self.filter_preference.tags.add(jazz_tag)
        FilterPreferenceWeekday.objects.bulk_create(
            FilterPreferenceWeekday(filter_preference=self.filter_preference, weekday=weekday)
            for weekday in (Weekday.SUNDAY, Weekday.SATURDAY)
        )
        self.assertEqual(list(self.user.filter_preference.tags.all()), [jazz_tag])
        self.assertEqual(
            list(self.user.filter_preference.weekdays.values_list("weekday", flat=True)),
            [Weekday.SATURDAY, Weekday.SUNDAY],
        )

    def test_a_weekday_is_saved_once(self):
        FilterPreferenceWeekday.objects.create(filter_preference=self.filter_preference, weekday=Weekday.FRIDAY)
        with self.assertRaises(IntegrityError):
            FilterPreferenceWeekday.objects.create(filter_preference=self.filter_preference, weekday=Weekday.FRIDAY)

    def test_weekday_must_be_iso_numbered(self):
        for invalid_weekday in (0, 8):
            with self.subTest(weekday=invalid_weekday), self.assertRaises(IntegrityError), transaction.atomic():
                FilterPreferenceWeekday.objects.create(
                    filter_preference=self.filter_preference, weekday=invalid_weekday
                )

    def test_deleting_a_tag_removes_it_from_filters(self):
        jazz_tag = Tag.objects.create(name="Jazz")
        self.filter_preference.tags.add(jazz_tag)
        jazz_tag.delete()
        self.assertEqual(self.filter_preference.tags.count(), 0)

    def test_deleting_the_user_deletes_their_filters(self):
        FilterPreferenceWeekday.objects.create(filter_preference=self.filter_preference, weekday=Weekday.MONDAY)
        self.user.delete()
        self.assertFalse(FilterPreference.objects.exists())
        self.assertFalse(FilterPreferenceWeekday.objects.exists())


class FilterPreferenceApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="ana@example.com", password=PASSWORD, name="Ana", adult_confirmed_at=timezone.now())
        self.other_user = User.objects.create_user(email="ben@example.com", password=PASSWORD, name="Ben", adult_confirmed_at=timezone.now())
        self.jazz_tag = Tag.objects.create(name="Jazz")
        self.art_tag = Tag.objects.create(name="Art")
        self.client.force_login(self.user)

    def url(self, user):
        return f"/api/users/{user.uuid}/filter-preference/"

    def test_nothing_saved_reads_as_no_filters(self):
        response = self.client.get(self.url(self.user))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"tags": [], "weekdays": [], "is_enabled": True})
        self.assertFalse(FilterPreference.objects.exists())

    def test_put_saves_tags_and_weekdays(self):
        response = self.client.put(
            self.url(self.user),
            {"tag_ids": [self.jazz_tag.id, self.art_tag.id], "weekdays": [7, 6, 6]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        expected_filters = {
            "tags": [{"id": self.art_tag.id, "name": "Art"}, {"id": self.jazz_tag.id, "name": "Jazz"}],
            "weekdays": [6, 7],
            "is_enabled": True,
        }
        self.assertEqual(response.json(), expected_filters)
        self.assertEqual(self.client.get(self.url(self.user)).json(), expected_filters)

    def test_put_replaces_the_saved_filters(self):
        self.client.put(self.url(self.user), {"tag_ids": [self.jazz_tag.id], "weekdays": [1, 2]}, format="json")
        response = self.client.put(self.url(self.user), {"tag_ids": [], "weekdays": [5]}, format="json")
        self.assertEqual(response.json(), {"tags": [], "weekdays": [5], "is_enabled": True})
        self.assertEqual(FilterPreference.objects.count(), 1)
        self.assertEqual(FilterPreferenceWeekday.objects.count(), 1)

    def test_patch_turns_the_filters_off_and_on_keeping_them(self):
        self.client.put(self.url(self.user), {"tag_ids": [self.jazz_tag.id], "weekdays": [6]}, format="json")
        response = self.client.patch(self.url(self.user), {"is_enabled": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"tags": [{"id": self.jazz_tag.id, "name": "Jazz"}], "weekdays": [6], "is_enabled": False},
        )
        # Saving new lists doesn't turn them back on by itself
        response = self.client.put(self.url(self.user), {"tag_ids": [], "weekdays": [1]}, format="json")
        self.assertFalse(response.json()["is_enabled"])
        response = self.client.patch(self.url(self.user), {"is_enabled": True}, format="json")
        self.assertTrue(response.json()["is_enabled"])
        self.assertEqual(response.json()["weekdays"], [1])

    def test_put_needs_both_lists(self):
        response = self.client.put(self.url(self.user), {"is_enabled": False}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"tag_ids", "weekdays"})

    def test_rejects_unknown_tags_and_weekdays(self):
        response = self.client.put(self.url(self.user), {"tag_ids": [999], "weekdays": [0, 8]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"tag_ids", "weekdays"})
        self.assertFalse(FilterPreference.objects.exists())

    def test_other_users_filters_are_hidden(self):
        self.assertEqual(self.client.get(self.url(self.other_user)).status_code, 404)
        response = self.client.put(self.url(self.other_user), {"tag_ids": [], "weekdays": []}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url(self.user)).status_code, 403)
