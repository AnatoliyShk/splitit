from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from .models import User

PASSWORD = "correct-horse-battery"


# Throttle counters live in the cache; keep them out of the dev Redis and reset per test
@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class AuthApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf_post(self, url, data=None):
        self.client.get("/api/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        return self.client.post(url, data or {}, format="json", HTTP_X_CSRFTOKEN=token)

    def me(self):
        return self.client.get("/api/auth/me/").json()["user"]

    def test_me_is_null_when_logged_out(self):
        self.assertIsNone(self.me())

    def test_register_creates_user_and_logs_in(self):
        res = self.csrf_post(
            "/api/auth/register/",
            {"email": "Ana@Example.com", "name": "Ana", "password": PASSWORD},
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["user"]["email"], "ana@example.com")
        self.assertEqual(self.me()["name"], "Ana")

    def test_register_rejects_duplicate_email_case_insensitively(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        res = self.csrf_post(
            "/api/auth/register/",
            {"email": "ANA@example.com", "name": "Ana 2", "password": PASSWORD},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.json())

    def test_register_rejects_weak_password(self):
        res = self.csrf_post(
            "/api/auth/register/",
            {"email": "ana@example.com", "name": "Ana", "password": "123"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.json())
        self.assertFalse(User.objects.exists())

    def test_login_and_logout(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        res = self.csrf_post("/api/auth/login/", {"email": "ANA@example.com", "password": PASSWORD})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.me()["email"], "ana@example.com")

        res = self.csrf_post("/api/auth/logout/")
        self.assertEqual(res.status_code, 204)
        self.assertIsNone(self.me())

    def test_login_rejects_wrong_password(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        res = self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["non_field_errors"], ["Email or password is incorrect."])
        self.assertIsNone(self.me())

    def test_login_requires_csrf_token(self):
        User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        res = self.client.post(
            "/api/auth/login/", {"email": "ana@example.com", "password": PASSWORD}, format="json"
        )
        self.assertEqual(res.status_code, 403)

    def test_login_is_rate_limited(self):
        for _ in range(10):
            self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        res = self.csrf_post("/api/auth/login/", {"email": "ana@example.com", "password": "nope"})
        self.assertEqual(res.status_code, 429)


class UserAdminTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin@example.com", PASSWORD, name="Admin")
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
        self.user = User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.user)

    def csrf(self, method, url, data):
        self.client.get("/api/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        return getattr(self.client, method)(url, data, format="json", HTTP_X_CSRFTOKEN=token)

    def test_me_includes_join_date(self):
        self.assertIn("date_joined", self.client.get("/api/auth/me/").json()["user"])

    def test_update_name(self):
        res = self.csrf("patch", "/api/auth/me/", {"name": "  Ana Petrova "})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["user"]["name"], "Ana Petrova")

    def test_blank_name_is_rejected(self):
        res = self.csrf("patch", "/api/auth/me/", {"name": "   "})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["name"], ["Enter your name."])

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
        res = self.csrf("post", "/api/auth/password/", {"current_password": PASSWORD, "new_password": new})
        self.assertEqual(res.status_code, 204)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new))
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["email"], "ana@example.com")

    def test_change_password_checks_current_and_strength(self):
        res = self.csrf("post", "/api/auth/password/", {"current_password": "nope", "new_password": "123"})
        self.assertEqual(res.status_code, 400)
        errors = res.json()
        self.assertEqual(errors["current_password"], ["Your current password is incorrect."])
        self.assertIn("new_password", errors)


class UserUuidTests(APITestCase):
    def test_users_get_distinct_time_ordered_uuid7s(self):
        first = User.objects.create_user("a@example.com", PASSWORD, name="A")
        second = User.objects.create_user("b@example.com", PASSWORD, name="B")
        self.assertEqual((first.uuid.version, second.uuid.version), (7, 7))
        self.assertLess(first.uuid, second.uuid)

    def test_me_exposes_uuid(self):
        user = User.objects.create_user("a@example.com", PASSWORD, name="A")
        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["uuid"], str(user.uuid))
