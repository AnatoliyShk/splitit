from django.core.cache import cache
from django.db.models import Case, F, When
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .cache import MY_CONNECTIONS_TTL, my_connections_key
from .models import Connection

# Longest list the profile shows
LIMIT = 50


class MyConnectionSerializer(serializers.Serializer):
    # The other person: public uuid and display name only, never email
    uuid = serializers.UUIDField(source="other_user.uuid")
    name = serializers.CharField(source="other_user.name")
    strength = serializers.FloatField()
    shared_events = serializers.IntegerField()


class UserConnectionsView(APIView):
    """GET /api/users/<uuid>/connections/: that user's strongest connections. Cached per user."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        key = my_connections_key(user.pk)
        data = cache.get(key)
        if data is None:
            connections = list(
                Connection.objects.for_user(user)
                .select_related("user_low", "user_high")
                .annotate(other_name=Case(When(user_low=user, then=F("user_high__name")), default=F("user_low__name")))
                .order_by("-strength", "other_name")[:LIMIT]
            )
            for c in connections:
                c.other_user = c.other(user)
            data = MyConnectionSerializer(connections, many=True).data
            cache.set(key, data, MY_CONNECTIONS_TTL)
        return Response(data)
