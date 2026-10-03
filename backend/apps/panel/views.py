import random
import uuid
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.filters import SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Event
from apps.tags.cache import LIST_TTL, list_cache_key
from apps.tags.models import Tag
from apps.users.models import User

from .serializers import PanelEventSerializer, PanelTagSerializer, PanelUserSerializer


class PanelPagination(PageNumberPagination):
    page_size = 20


def upcoming_events():
    """Events that haven't happened yet or are still running (an event with no end is over once it starts)."""
    now = timezone.now()
    return Event.objects.filter(Q(start_datetime__gte=now) | Q(end_datetime__gt=now))


class StatsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        week_ago = timezone.now() - timedelta(days=7)
        users = User.objects.aggregate(
            total=Count("id"),
            active=Count("id", filter=Q(is_active=True)),
            staff=Count("id", filter=Q(is_staff=True)),
            new_this_week=Count("id", filter=Q(date_joined__gte=week_ago)),
        )
        upcoming = upcoming_events()
        next_events = upcoming.annotate(attendees_count=Count("users")).order_by("start_datetime")[:5]
        return Response(
            {
                "users": users,
                "events": {"total": Event.objects.count(), "upcoming": upcoming.count()},
                "next_events": [
                    {
                        "id": e.id,
                        "name": e.name,
                        "start_datetime": e.start_datetime,
                        "end_datetime": e.end_datetime,
                        "attendees_count": e.attendees_count,
                    }
                    for e in next_events
                ],
            }
        )


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAdminUser]
    serializer_class = PanelUserSerializer
    pagination_class = PanelPagination
    filter_backends = [SearchFilter]
    search_fields = ["email", "name"]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return User.objects.annotate(events_count=Count("events")).order_by("-date_joined")

    def perform_update(self, serializer):
        target = serializer.instance
        # Guard against locking yourself out or a staff member demoting a superuser
        if target.pk == self.request.user.pk:
            raise PermissionDenied("You can't change your own access.")
        if target.is_superuser and not self.request.user.is_superuser:
            raise PermissionDenied("Only a superuser can change another superuser.")
        serializer.save()


TEST_EVENT_NAMES = [
    "Jazz night",
    "Board games",
    "Morning run",
    "Pub quiz",
    "Film club",
    "Climbing session",
    "Food market",
    "Gallery opening",
]
TEST_USER_NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Jamie"]


def pick_test_attendees(count):
    """`count` random non-staff users, creating test accounts when there aren't enough."""
    users = list(User.objects.filter(is_staff=False, is_active=True).order_by("?")[:count])
    for _ in range(count - len(users)):
        # No password: these accounts exist only to fill events and can't log in
        users.append(
            User.objects.create_user(
                f"test-{uuid.uuid4().hex[:8]}@example.com", name=f"{random.choice(TEST_USER_NAMES)} (test)"
            )
        )
    return users


def create_test_event():
    """An event at a random time in the next 30 days with 1-3 random attendees."""
    # On the quarter hour, so the times look like a real schedule
    now = timezone.now()
    quarter = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    start = quarter + timedelta(minutes=15 * random.randint(4, 30 * 24 * 4))
    end = start + timedelta(minutes=30 * random.randint(2, 12))
    with transaction.atomic():
        event = Event.objects.create(
            name=f"Test: {random.choice(TEST_EVENT_NAMES)}", start_datetime=start, end_datetime=end
        )
        event.users.add(*pick_test_attendees(random.randint(1, 3)))
    return event


class EventViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = PanelEventSerializer
    pagination_class = PanelPagination
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return Event.objects.prefetch_related("users").order_by("-start_datetime", "-id")

    @action(detail=False, methods=["post"], url_path="test")
    def create_test(self, request):
        """POST /api/panel/events/test/: create a test event (see create_test_event)."""
        event = create_test_event()
        return Response(self.get_serializer(event).data, status=status.HTTP_201_CREATED)


class TagViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = PanelTagSerializer
    pagination_class = PanelPagination
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return Tag.objects.annotate(events_count=Count("events")).order_by(Lower("name"))

    def list(self, request, *args, **kwargs):
        # Permissions are checked before list() runs, so only staff ever see cached pages
        key = list_cache_key(request.query_params)
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)
        response = super().list(request, *args, **kwargs)
        cache.set(key, response.data, LIST_TTL)
        return response
