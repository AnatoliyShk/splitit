from django.core.cache import cache
from django.db.models import Case, F, When, Window
from django.db.models.functions import RowNumber
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .cache import MY_CONNECTIONS_TTL, my_connections_key
from .models import Connection

# Longest list the profile shows
LIMIT = 50
# The graph adds each connection's strongest links to people outside the user's own circle
SECOND_DEGREE_PER_PERSON = 3
SECOND_DEGREE_LIMIT = 60


class MyConnectionSerializer(serializers.Serializer):
    # The other person: public uuid and display name only, never email
    uuid = serializers.UUIDField(source="other_user.uuid")
    name = serializers.CharField(source="other_user.name")
    strength = serializers.FloatField()
    shared_occasions = serializers.IntegerField()


class UserConnectionsView(APIView):
    """GET /api/users/<uuid>/connections/: that user's strongest connections. Cached per user."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        cache_key = my_connections_key(user.pk)
        connections_data = cache.get(cache_key)
        if connections_data is None:
            connections = list(
                Connection.objects.for_user(user)
                .select_related("user_low", "user_high")
                .annotate(other_name=Case(When(user_low=user, then=F("user_high__name")), default=F("user_low__name")))
                .order_by("-strength", "other_name")[:LIMIT]
            )
            for connection in connections:
                connection.other_user = connection.other(user)
            connections_data = MyConnectionSerializer(connections, many=True).data
            cache.set(cache_key, connections_data, MY_CONNECTIONS_TTL)
        return Response(connections_data)


class UserConnectionsGraphView(APIView):
    """GET /api/users/<uuid>/connections/graph/: that user's network, for drawing.

    Nodes are the user (degree 0), their strongest connections (degree 1) and, for each of those,
    up to SECOND_DEGREE_PER_PERSON of their strongest links to people the user isn't connected
    to (degree 2). Edges are every connection among degree 0 and 1, plus the links that brought in
    each degree-2 person. Names and public uuids only, never emails. Not cached: it depends on
    other people's connections, which the per-user cache keys don't track.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        people = {user.pk: (user, 0)}  # user id -> (user, degree)
        edge_connections = []

        my_connections = (
            Connection.objects.for_user(user).select_related("user_low", "user_high").order_by("-strength")
        )
        for connection in my_connections[:LIMIT]:
            friend = connection.other(user)
            people[friend.pk] = (friend, 1)
            edge_connections.append(connection)
        friend_ids = [user_id for user_id, (_, degree) in people.items() if degree == 1]

        # Links between the user's own connections
        edge_connections += Connection.objects.filter(user_low__in=friend_ids, user_high__in=friend_ids).select_related(
            "user_low", "user_high"
        )

        # Each connection's strongest links to outsiders. A pair row can name the friend on either
        # side, so rank each side separately and merge the two top lists per friend below.
        known_user_ids = [*people]
        candidates_by_friend = {}  # friend id -> their strongest connections to outsiders
        for side, other_side in (("user_low", "user_high"), ("user_high", "user_low")):
            side_connections = (
                Connection.objects.filter(**{f"{side}__in": friend_ids})
                .exclude(**{f"{other_side}__in": known_user_ids})
                .annotate(rank=Window(RowNumber(), partition_by=F(side), order_by=F("strength").desc()))
                .filter(rank__lte=SECOND_DEGREE_PER_PERSON)
                .select_related("user_low", "user_high")
            )
            for connection in side_connections:
                candidates_by_friend.setdefault(getattr(connection, f"{side}_id"), []).append(connection)
        picked_connections = [
            connection
            for friend_connections in candidates_by_friend.values()
            for connection in sorted(friend_connections, key=lambda candidate: -candidate.strength)[
                :SECOND_DEGREE_PER_PERSON
            ]
        ]
        # Strongest links first, so the cap drops the weakest outsiders
        for connection in sorted(picked_connections, key=lambda candidate: -candidate.strength):
            outsider = connection.user_high if connection.user_low_id in friend_ids else connection.user_low
            if outsider.pk not in people:
                if len(people) - len(friend_ids) - 1 >= SECOND_DEGREE_LIMIT:
                    continue
                people[outsider.pk] = (outsider, 2)
            edge_connections.append(connection)

        return Response(
            {
                "nodes": [
                    {"uuid": str(person.uuid), "name": person.name, "degree": degree}
                    for person, degree in people.values()
                ],
                "edges": [
                    {
                        "source": str(connection.user_low.uuid),
                        "target": str(connection.user_high.uuid),
                        "strength": connection.strength,
                    }
                    for connection in edge_connections
                ],
            }
        )
