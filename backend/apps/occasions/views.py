from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .models import Occasion


class UserOccasionSerializer(serializers.ModelSerializer):
    attendees_count = serializers.IntegerField(read_only=True)
    tags = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")

    class Meta:
        model = Occasion
        fields = ("id", "name", "start_datetime", "end_datetime", "attendees_count", "tags")


class UserOccasionsView(APIView):
    """GET /api/users/<uuid>/occasions/: occasions that user is going to, soonest first."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        # Filter by id first: annotating user.occasions directly would count only this user per occasion
        occasions = (
            Occasion.objects.filter(id__in=user.occasions.values("id"))
            .annotate(attendees_count=Count("users"))
            .prefetch_related("tags")
            .order_by("start_datetime")
        )
        return Response(UserOccasionSerializer(occasions, many=True).data)


def upcoming_occasions():
    """Occasions that haven't ended yet (or started, when they have no end)."""
    now = timezone.now()
    return Occasion.objects.filter(Q(end_datetime__gte=now) | Q(end_datetime=None, start_datetime__gte=now))


class ExploreOccasionsView(APIView):
    """GET /api/occasions/explore/: upcoming occasions the requester isn't going to yet, soonest first."""

    permission_classes = [IsAuthenticated]
    limit = 50

    def get(self, request):
        occasions = (
            upcoming_occasions()
            .exclude(users=request.user)
            .annotate(attendees_count=Count("users"))
            .prefetch_related("tags")
            .order_by("start_datetime", "id")[: self.limit]
        )
        return Response(UserOccasionSerializer(occasions, many=True).data)


class JoinOccasionView(APIView):
    """POST /api/occasions/<id>/join/: the requester goes to an upcoming occasion."""

    permission_classes = [IsAuthenticated]

    def post(self, request, occasion_id):
        occasion = get_object_or_404(upcoming_occasions(), id=occasion_id)
        occasion.users.add(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
