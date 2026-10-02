from django.db.models import Count
from rest_framework import serializers
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
