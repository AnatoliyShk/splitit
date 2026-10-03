from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .models import Event


class UserEventSerializer(serializers.ModelSerializer):
    attendees_count = serializers.IntegerField(read_only=True)
    tags = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")

    class Meta:
        model = Event
        fields = ("id", "name", "start_datetime", "end_datetime", "attendees_count", "tags")


class UserEventsView(APIView):
    """GET /api/users/<uuid>/events/: events that user is going to, soonest first."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        # Filter by id first: annotating user.events directly would count only this user per event
        events = (
            Event.objects.filter(id__in=user.events.values("id"))
            .annotate(attendees_count=Count("users"))
            .prefetch_related("tags")
            .order_by("start_datetime")
        )
        return Response(UserEventSerializer(events, many=True).data)


def upcoming_events():
    """Events that haven't ended yet (or started, when they have no end)."""
    now = timezone.now()
    return Event.objects.filter(Q(end_datetime__gte=now) | Q(end_datetime=None, start_datetime__gte=now))


class ExploreEventsView(APIView):
    """GET /api/events/explore/: upcoming events the requester isn't going to yet, soonest first."""

    permission_classes = [IsAuthenticated]
    limit = 50

    def get(self, request):
        events = (
            upcoming_events()
            .exclude(users=request.user)
            .annotate(attendees_count=Count("users"))
            .prefetch_related("tags")
            .order_by("start_datetime", "id")[: self.limit]
        )
        return Response(UserEventSerializer(events, many=True).data)


class JoinEventView(APIView):
    """POST /api/events/<id>/join/: the requester goes to an upcoming event."""

    permission_classes = [IsAuthenticated]

    def post(self, request, event_id):
        event = get_object_or_404(upcoming_events(), id=event_id)
        event.users.add(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
