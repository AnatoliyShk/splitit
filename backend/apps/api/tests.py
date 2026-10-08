from django.test import TestCase
from django.utils import timezone

from apps.users.models import User


class ApiDocsTests(TestCase):
    def setUp(self):
        self.staff_user = User.objects.create_user("sam@example.com", "correct-horse-battery", name="Sam", is_staff=True, adult_confirmed_at=timezone.now())
        self.member_user = User.objects.create_user("ana@example.com", "correct-horse-battery", name="Ana", adult_confirmed_at=timezone.now())

    def schema_paths(self, url):
        response = self.client.get(url, {"format": "json"})
        self.assertEqual(response.status_code, 200)
        return list(response.json()["paths"])

    def test_public_docs_leave_out_the_admin_api(self):
        # As staff, so this holds whether or not DEBUG opens the public docs to everyone
        self.client.force_login(self.staff_user)
        public_paths = self.schema_paths("/api/schema/")
        self.assertIn("/api/occasions/explore/", public_paths)
        self.assertFalse([path for path in public_paths if path.startswith("/api/admin/")])

    def test_admin_docs_list_only_the_admin_api(self):
        self.client.force_login(self.staff_user)
        admin_paths = self.schema_paths("/api/admin/schema/")
        self.assertIn("/api/admin/occasions/", admin_paths)
        self.assertTrue(all(path.startswith("/api/admin/") for path in admin_paths))
        self.assertEqual(self.client.get("/api/admin/docs/").status_code, 200)

    def test_admin_docs_are_staff_only(self):
        for url in ("/api/admin/schema/", "/api/admin/docs/"):
            with self.subTest(url=url, user="anonymous"):
                self.assertEqual(self.client.get(url).status_code, 403)
        self.client.force_login(self.member_user)
        for url in ("/api/admin/schema/", "/api/admin/docs/"):
            with self.subTest(url=url, user="member"):
                self.assertEqual(self.client.get(url).status_code, 403)
