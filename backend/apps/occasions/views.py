from django.db.models import Count, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.access import user_from_url

from .models import MAIN_IMAGE_ORDER, Occasion, OccasionUser
from .services import AlreadyGoing, active_occasions, join


class UserOccasionSerializer(serializers.ModelSerializer):
    attendees_count = serializers.IntegerField(read_only=True)
    tags = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")
    # URL of the image shown on previews (cards, lists), or null
    main_image = serializers.SerializerMethodField()

    class Meta:
        model = Occasion
        fields = (
            "id",
            "name",
            "start_datetime",
            "end_datetime",
            "cancelled_at",
            "attendees_count",
            "tags",
            "main_image",
        )

    def get_main_image(self, occasion) -> str | None:
        # Reads the prefetched images (see with_details), so a list costs no query per occasion
        main = next((i for i in occasion.images.all() if i.order == MAIN_IMAGE_ORDER), None)
        return main.image.url if main else None


class OccasionDetailSerializer(UserOccasionSerializer):
    # Gallery image URLs in order, without the main image
    gallery = serializers.SerializerMethodField()
    is_going = serializers.BooleanField(read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "gallery", "is_going")

    def get_gallery(self, occasion) -> list[str]:
        return [i.image.url for i in occasion.images.all() if i.order != MAIN_IMAGE_ORDER]


def with_details(occasions):
    return occasions.annotate(attendees_count=Count("users")).prefetch_related("tags", "images")


class UserOccasionsView(APIView):
    """GET /api/users/<uuid>/occasions/: occasions that user is going to, soonest first."""

    permission_classes = [IsAuthenticated]

    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        # Filter by id first: annotating user.occasions directly would count only this user per occasion
        occasions = with_details(Occasion.objects.filter(id__in=user.occasions.values("id"))).order_by(
            "start_datetime"
        )
        return Response(UserOccasionSerializer(occasions, many=True).data)


class ExploreOccasionsView(APIView):
    """GET /api/occasions/explore/: the requester's active occasion, or the upcoming ones they could join.

    A user goes to one occasion at a time: while `active_occasion` is set, `occasions` is empty.
    Otherwise it lists upcoming occasions the requester isn't going to yet, soonest first.
    """

    permission_classes = [IsAuthenticated]
    limit = 50

    def get(self, request):
        active = with_details(active_occasions(request.user)).order_by("start_datetime").first()
        occasions = []
        if active is None:
            occasions = with_details(Occasion.objects.upcoming().exclude(users=request.user)).order_by(
                "start_datetime", "id"
            )[: self.limit]
        return Response(
            {
                "active_occasion": active and UserOccasionSerializer(active).data,
                "occasions": UserOccasionSerializer(occasions, many=True).data,
            }
        )


class JoinOccasionView(APIView):
    """POST /api/occasions/<id>/join/: the requester goes to an upcoming occasion.

    409 while they're going to another occasion that hasn't ended or been cancelled.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, occasion_id):
        occasion = get_object_or_404(Occasion.objects.upcoming(), id=occasion_id)
        try:
            join(occasion, request.user)
        except AlreadyGoing as e:
            return Response(
                {
                    "detail": f"You're already going to {e.occasion.name}. "
                    "You can join another occasion once it ends or is cancelled."
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class OccasionDetailView(APIView):
    """GET /api/occasions/<id>/: one occasion with its main image and gallery, for its own page."""

    permission_classes = [IsAuthenticated]

    def get(self, request, occasion_id):
        going = OccasionUser.objects.filter(occasion=OuterRef("pk"), user=request.user)
        occasion = get_object_or_404(with_details(Occasion.objects.annotate(is_going=Exists(going))), id=occasion_id)
        return Response(OccasionDetailSerializer(occasion).data)
