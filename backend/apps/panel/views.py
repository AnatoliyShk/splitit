from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.filters import SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Event
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


class EventViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = PanelEventSerializer
    pagination_class = PanelPagination
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return Event.objects.prefetch_related("users").order_by("-start_datetime", "-id")


class TagViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = PanelTagSerializer
    pagination_class = PanelPagination
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return Tag.objects.annotate(events_count=Count("events")).order_by(Lower("name"))
