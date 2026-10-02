from django.core.cache import cache
from django.db import IntegrityError
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from apps.users.models import User

from .models import Membership, SocialCircle

PASSWORD = "correct-horse-battery"
LOCMEM_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class MembershipModelTests(TestCase):
    def test_links_users_and_circles_both_ways(self):
        user = User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        circle = SocialCircle.objects.create(name="Jazz fans")
        Membership.objects.create(user=user, circle=circle, interest=0.7)
        self.assertEqual(list(user.social_circles.all()), [circle])
        self.assertEqual(list(circle.users.all()), [user])

    def test_user_joins_a_circle_once(self):
        user = User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        circle = SocialCircle.objects.create(name="Jazz fans")
        Membership.objects.create(user=user, circle=circle)
        with self.assertRaises(IntegrityError):
            Membership.objects.create(user=user, circle=circle)


# The list is cached; keep it out of the dev Redis and reset per test
@override_settings(CACHES=LOCMEM_CACHE)
class UserCirclesApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.ana = User.objects.create_user("ana@example.com", PASSWORD, name="Ana")
        self.ben = User.objects.create_user("ben@example.com", PASSWORD, name="Ben")
        self.jazz = SocialCircle.objects.create(name="Jazz fans")
        self.hikers = SocialCircle.objects.create(name="Hikers")
        self.login(self.ana)

    def login(self, user):
        self.me = user
        self.client.force_login(user)

    @property
    def url(self):
        return f"/api/users/{self.me.uuid}/circles/"

    def join(self, user, circle, interest):
        with self.captureOnCommitCallbacks(execute=True):
            return Membership.objects.create(user=user, circle=circle, interest=interest)

    def names(self):
        return [c["name"] for c in self.client.get(self.url).json()]

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_lists_own_circles_by_interest_descending(self):
        self.join(self.ana, self.jazz, 0.2)
        self.join(self.ana, self.hikers, 0.9)
        self.join(self.ben, SocialCircle.objects.create(name="Not mine"), 1.0)
        self.assertEqual(
            self.client.get(self.url).json(),
            [
                {"id": self.hikers.pk, "name": "Hikers", "interest": 0.9},
                {"id": self.jazz.pk, "name": "Jazz fans", "interest": 0.2},
            ],
        )

    def test_repeat_requests_are_served_from_cache(self):
        membership = self.join(self.ana, self.jazz, 0.5)
        self.assertEqual(self.names(), ["Jazz fans"])
        # update() sends no signals, so only a cache hit can still show the old name
        SocialCircle.objects.filter(pk=self.jazz.pk).update(name="Blues fans")
        Membership.objects.filter(pk=membership.pk).update(interest=0.1)
        self.assertEqual(self.names(), ["Jazz fans"])

    def test_cache_is_per_user(self):
        self.join(self.ana, self.jazz, 0.5)
        self.join(self.ben, self.hikers, 0.5)
        self.assertEqual(self.names(), ["Jazz fans"])
        self.login(self.ben)
        self.assertEqual(self.names(), ["Hikers"])

    def test_membership_changes_refresh_the_list(self):
        self.join(self.ana, self.jazz, 0.5)
        hikers = self.join(self.ana, self.hikers, 0.1)
        self.assertEqual(self.names(), ["Jazz fans", "Hikers"])
        with self.captureOnCommitCallbacks(execute=True):
            hikers.interest = 0.8
            hikers.save()
        self.assertEqual(self.names(), ["Hikers", "Jazz fans"])
        with self.captureOnCommitCallbacks(execute=True):
            hikers.delete()
        self.assertEqual(self.names(), ["Jazz fans"])

    def test_renaming_a_circle_refreshes_every_member(self):
        self.join(self.ana, self.jazz, 0.5)
        self.join(self.ben, self.jazz, 0.5)
        self.names()
        with self.captureOnCommitCallbacks(execute=True):
            self.jazz.name = "Blues fans"
            self.jazz.save()
        self.assertEqual(self.names(), ["Blues fans"])
        self.login(self.ben)
        self.assertEqual(self.names(), ["Blues fans"])

    def test_deleting_a_circle_refreshes_its_members(self):
        self.join(self.ana, self.jazz, 0.5)
        self.assertEqual(self.names(), ["Jazz fans"])
        with self.captureOnCommitCallbacks(execute=True):
            self.jazz.delete()
        self.assertEqual(self.names(), [])

    def test_related_manager_changes_refresh_the_list(self):
        self.assertEqual(self.names(), [])
        with self.captureOnCommitCallbacks(execute=True):
            self.ana.social_circles.add(self.jazz, through_defaults={"interest": 0.3})
        self.assertEqual(self.names(), ["Jazz fans"])
        with self.captureOnCommitCallbacks(execute=True):
            self.hikers.users.add(self.ana, through_defaults={"interest": 0.6})
        self.assertEqual(self.names(), ["Hikers", "Jazz fans"])
        with self.captureOnCommitCallbacks(execute=True):
            self.hikers.users.clear()
        self.assertEqual(self.names(), ["Jazz fans"])
        with self.captureOnCommitCallbacks(execute=True):
            self.ana.social_circles.remove(self.jazz)
        self.assertEqual(self.names(), [])

    def test_other_users_circles_are_hidden(self):
        self.join(self.ben, self.hikers, 0.5)
        res = self.client.get(f"/api/users/{self.ben.uuid}/circles/")
        self.assertEqual(res.status_code, 404)

    def test_staff_can_view_anyones_circles(self):
        self.join(self.ben, self.hikers, 0.5)
        self.ana.is_staff = True
        self.ana.save()
        res = self.client.get(f"/api/users/{self.ben.uuid}/circles/")
        self.assertEqual([c["name"] for c in res.json()], ["Hikers"])
