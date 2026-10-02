from django.core.cache import cache
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .cache import MY_CIRCLES_TTL, my_circles_key
from .models import Membership


class MyCircleSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="circle_id")
    name = serializers.CharField(source="circle.name")

    class Meta:
        model = Membership
        fields = ("id", "name", "interest")


class UserCirclesView(APIView):
    """GET /api/users/<uuid>/circles/: that user's social circles, most interesting first. Cached per user."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        key = my_circles_key(user.pk)
        data = cache.get(key)
        if data is None:
            memberships = (
                Membership.objects.filter(user=user)
                .select_related("circle")
                .order_by("-interest", "circle__name")
            )
            data = MyCircleSerializer(memberships, many=True).data
            cache.set(key, data, MY_CIRCLES_TTL)
        return Response(data)
