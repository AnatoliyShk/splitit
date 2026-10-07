from django.db.models.functions import Lower
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Tag
from .serializers import TagSerializer


class TagListView(APIView):
    """GET /api/tags/: every tag, A to Z, for choosing Explore filters."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="Every tag, A to Z", responses=TagSerializer(many=True))
    def get(self, request):
        tags = Tag.objects.order_by(Lower("name"))
        return Response(TagSerializer(tags, many=True).data)
