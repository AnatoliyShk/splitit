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
