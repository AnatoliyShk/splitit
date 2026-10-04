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
        people = {user.pk: (user, 0)}
        edges = []

        mine = Connection.objects.for_user(user).select_related("user_low", "user_high").order_by("-strength")
        for c in mine[:LIMIT]:
            people[c.other(user).pk] = (c.other(user), 1)
            edges.append(c)
        friend_ids = [pk for pk, (_, degree) in people.items() if degree == 1]

        # Links between the user's own connections
        edges += Connection.objects.filter(user_low__in=friend_ids, user_high__in=friend_ids).select_related(
            "user_low", "user_high"
        )

        # Each connection's strongest links to outsiders. A pair row can name the friend on either
        # side, so rank each side separately and merge the two top lists per friend below.
        known = [*people]
        candidates = {}
        for side, other in (("user_low", "user_high"), ("user_high", "user_low")):
            rows = (
                Connection.objects.filter(**{f"{side}__in": friend_ids})
                .exclude(**{f"{other}__in": known})
                .annotate(rank=Window(RowNumber(), partition_by=F(side), order_by=F("strength").desc()))
                .filter(rank__lte=SECOND_DEGREE_PER_PERSON)
                .select_related("user_low", "user_high")
            )
            for c in rows:
                candidates.setdefault(getattr(c, f"{side}_id"), []).append(c)
        picked = [
            c
            for rows in candidates.values()
            for c in sorted(rows, key=lambda c: -c.strength)[:SECOND_DEGREE_PER_PERSON]
        ]
        # Strongest links first, so the cap drops the weakest outsiders
        for c in sorted(picked, key=lambda c: -c.strength):
            outsider = c.user_high if c.user_low_id in friend_ids else c.user_low
            if outsider.pk not in people:
                if len(people) - len(friend_ids) - 1 >= SECOND_DEGREE_LIMIT:
                    continue
                people[outsider.pk] = (outsider, 2)
            edges.append(c)

        return Response(
            {
                "nodes": [{"uuid": str(u.uuid), "name": u.name, "degree": d} for u, d in people.values()],
                "edges": [
                    {"source": str(c.user_low.uuid), "target": str(c.user_high.uuid), "strength": c.strength}
                    for c in edges
                ],
            }
        )
