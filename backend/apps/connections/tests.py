from datetime import timedelta
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.tasks import default_task_backend
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.events.models import Event
from apps.users.models import User

from . import views
from .models import Connection
from .services import apply_event

PASSWORD = "correct-horse-battery"
LOCMEM_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
DUMMY_TASKS = {"default": {"BACKEND": "django.tasks.backends.dummy.DummyBackend"}}


def make_users(*names):
    return [User.objects.create_user(f"{n.lower()}@example.com", PASSWORD, name=n) for n in names]


def past_event(*users, name="Gig"):
    start = timezone.now() - timedelta(days=1)
    event = Event.objects.create(name=name, start_datetime=start, end_datetime=start + timedelta(hours=2))
    event.users.add(*users)
    return event


def strength(a, b):
    low, high = sorted([a, b], key=lambda u: u.pk)
    return Connection.objects.get(user_low=low, user_high=high)


class ConnectionModelTests(TestCase):
    def setUp(self):
        self.ana, self.ben = make_users("Ana", "Ben")
        self.low, self.high = sorted([self.ana, self.ben], key=lambda u: u.pk)

    def test_pair_must_be_ordered(self):
        with self.assertRaises(IntegrityError):
            Connection.objects.create(user_low=self.high, user_high=self.low)

    def test_pair_is_unique(self):
        Connection.objects.create(user_low=self.low, user_high=self.high)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Connection.objects.create(user_low=self.low, user_high=self.high)

    def test_lookups_work_from_either_side(self):
        connection = Connection.objects.create(user_low=self.low, user_high=self.high)
        self.assertEqual(list(Connection.objects.for_user(self.ana)), [connection])
        self.assertEqual(list(Connection.objects.for_user(self.ben)), [connection])
        self.assertEqual(connection.other(self.ana), self.ben)
        self.assertEqual(connection.other(self.ben), self.ana)


@override_settings(CACHES=LOCMEM_CACHE)
class ApplyEventTests(TestCase):
    def setUp(self):
        cache.clear()
        self.ana, self.ben, self.cy, self.dan = make_users("Ana", "Ben", "Cy", "Dan")

    def test_every_pair_gets_one_over_attendees_minus_one(self):
        event = past_event(self.ana, self.ben, self.cy)
        self.assertTrue(apply_event(event.pk))
        self.assertEqual(Connection.objects.count(), 3)
        for a, b in [(self.ana, self.ben), (self.ana, self.cy), (self.ben, self.cy)]:
            c = strength(a, b)
            self.assertAlmostEqual(c.strength, 0.5)
            self.assertEqual(c.shared_events, 1)
        event.refresh_from_db()
        self.assertIsNotNone(event.connections_applied_at)

    def test_shared_events_add_up(self):
        apply_event(past_event(self.ana, self.ben, self.cy).pk)  # +0.5
        apply_event(past_event(self.ana, self.ben).pk)  # +1
        c = strength(self.ana, self.ben)
        self.assertAlmostEqual(c.strength, 1.5)
        self.assertEqual(c.shared_events, 2)

    def test_an_event_counts_once(self):
        event = past_event(self.ana, self.ben)
        apply_event(event.pk)
        self.assertFalse(apply_event(event.pk))
        self.assertAlmostEqual(strength(self.ana, self.ben).strength, 1.0)

    def test_events_that_have_not_ended_are_skipped(self):
        start = timezone.now() - timedelta(hours=1)
        running = Event.objects.create(name="Running", start_datetime=start, end_datetime=start + timedelta(hours=3))
        running.users.add(self.ana, self.ben)
        self.assertFalse(apply_event(running.pk))
        self.assertFalse(Connection.objects.exists())

    def test_event_without_end_is_over_once_it_starts(self):
        event = Event.objects.create(name="Meetup", start_datetime=timezone.now() - timedelta(minutes=1))
        event.users.add(self.ana, self.ben)
        self.assertTrue(apply_event(event.pk))

    def test_single_attendee_is_just_marked(self):
        event = past_event(self.ana)
        self.assertTrue(apply_event(event.pk))
        self.assertFalse(Connection.objects.exists())

    def test_people_who_left_before_it_ended_get_no_connection(self):
        event = past_event(self.ana, self.ben, self.cy)
        event.users.remove(self.cy)
        apply_event(event.pk)
        self.assertEqual(Connection.objects.for_user(self.cy).count(), 0)
        self.assertAlmostEqual(strength(self.ana, self.ben).strength, 1.0)

    def test_large_events_are_written_in_batches(self):
        crowd = make_users(*[f"Guest{i}" for i in range(50)])  # 1,225 pairs: more than one batch
        apply_event(past_event(*crowd).pk)
        self.assertEqual(Connection.objects.count(), 50 * 49 // 2)
        self.assertAlmostEqual(strength(crowd[0], crowd[-1]).strength, 1 / 49)


@override_settings(TASKS=DUMMY_TASKS)
class SchedulingTests(TestCase):
    def setUp(self):
        default_task_backend.clear()

    def enqueued(self):
        return [r for r in default_task_backend.results if r.task.name == "apply_event_connections"]

    def test_saving_an_event_schedules_it_for_when_it_ends(self):
        end = timezone.now() + timedelta(days=2)
        with self.captureOnCommitCallbacks(execute=True):
            event = Event.objects.create(name="Gig", start_datetime=end - timedelta(hours=2), end_datetime=end)
        [job] = self.enqueued()
        self.assertEqual(job.args, [event.pk])
        self.assertEqual(job.task.run_after, end)

    def test_ended_events_run_straight_away(self):
        with self.captureOnCommitCallbacks(execute=True):
            past_event()
        [job] = self.enqueued()
        self.assertIsNone(job.task.run_after)

    def test_counted_events_are_not_scheduled_again(self):
        event = past_event()
        apply_event(event.pk)
        event.refresh_from_db()
        default_task_backend.clear()
        with self.captureOnCommitCallbacks(execute=True):
            event.name = "Renamed"
            event.save()
        self.assertEqual(self.enqueued(), [])


@override_settings(CACHES=LOCMEM_CACHE)
class ApplyConnectionsCommandTests(TestCase):
    def setUp(self):
        cache.clear()
        self.ana, self.ben, self.cy = make_users("Ana", "Ben", "Cy")

    def test_counts_only_ended_uncounted_events(self):
        counted = past_event(self.ana, self.ben)
        apply_event(counted.pk)
        past_event(self.ana, self.ben, self.cy)
        future = Event.objects.create(name="Later", start_datetime=timezone.now() + timedelta(days=1))
        future.users.add(self.ana, self.ben)

        out = StringIO()
        call_command("apply_connections", stdout=out)
        self.assertIn("1 event(s)", out.getvalue())
        self.assertAlmostEqual(strength(self.ana, self.ben).strength, 1.5)

    def test_rebuild_reproduces_the_same_totals(self):
        apply_event(past_event(self.ana, self.ben, self.cy).pk)
        apply_event(past_event(self.ana, self.ben).pk)
        before = {(c.user_low_id, c.user_high_id): (c.strength, c.shared_events) for c in Connection.objects.all()}

        call_command("apply_connections", "--rebuild", stdout=StringIO())
        after = {(c.user_low_id, c.user_high_id): (c.strength, c.shared_events) for c in Connection.objects.all()}
        self.assertEqual(after, before)


@override_settings(CACHES=LOCMEM_CACHE)
class UserConnectionsApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.ana, self.ben, self.cy = make_users("Ana", "Ben", "Cy")
        self.client.force_login(self.ana)

    def url(self, user=None):
        return f"/api/users/{(user or self.ana).uuid}/connections/"

    def get(self, user=None):
        return self.client.get(self.url(user)).json()

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_other_users_lists_are_hidden(self):
        self.assertEqual(self.client.get(self.url(self.ben)).status_code, 404)

    def test_strongest_first_from_either_side_without_email(self):
        apply_event(past_event(self.ana, self.ben, self.cy).pk)  # everyone +0.5
        apply_event(past_event(self.ana, self.cy).pk)  # Ana–Cy +1
        self.assertEqual(
            self.get(),
            [
                {"uuid": str(self.cy.uuid), "name": "Cy", "strength": 1.5, "shared_events": 2},
                {"uuid": str(self.ben.uuid), "name": "Ben", "strength": 0.5, "shared_events": 1},
            ],
        )
        self.client.force_login(self.cy)
        self.assertEqual([c["name"] for c in self.get(self.cy)], ["Ana", "Ben"])

    def test_list_is_capped(self):
        crowd = make_users(*[f"Guest{i}" for i in range(views.LIMIT)])
        apply_event(past_event(self.ana, *crowd).pk)
        self.assertEqual(len(self.get()), views.LIMIT)

    def test_repeat_requests_are_served_from_cache_until_an_event_is_counted(self):
        apply_event(past_event(self.ana, self.ben).pk)
        self.assertEqual(self.get()[0]["strength"], 1.0)
        # update() sends no signals, so only a cache hit can still show the old value
        Connection.objects.update(strength=9.0)
        self.assertEqual(self.get()[0]["strength"], 1.0)

        with self.captureOnCommitCallbacks(execute=True):
            apply_event(past_event(self.ana, self.ben).pk)
        self.assertEqual(self.get()[0]["strength"], 10.0)

    def test_deleting_a_user_refreshes_the_other_side(self):
        apply_event(past_event(self.ana, self.ben).pk)
        self.assertEqual(len(self.get()), 1)
        with self.captureOnCommitCallbacks(execute=True):
            self.ben.delete()
        self.assertEqual(self.get(), [])

    def test_rebuild_drops_every_cached_list(self):
        apply_event(past_event(self.ana, self.ben).pk)
        self.assertEqual(self.get()[0]["strength"], 1.0)
        Connection.objects.update(strength=9.0)
        call_command("apply_connections", "--rebuild", stdout=StringIO())
        self.assertEqual(self.get()[0]["strength"], 1.0)
