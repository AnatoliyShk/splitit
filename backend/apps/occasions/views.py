from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.connections.models import Connection
from apps.users.access import user_from_url
from apps.users.models import User

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
        main_image = next((image for image in occasion.images.all() if image.order == MAIN_IMAGE_ORDER), None)
        return main_image.image.url if main_image else None


class OccasionDetailSerializer(UserOccasionSerializer):
    # Gallery image URLs in order, without the main image
    gallery = serializers.SerializerMethodField()
    is_going = serializers.BooleanField(read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "gallery", "is_going")

    def get_gallery(self, occasion) -> list[str]:
        return [image.image.url for image in occasion.images.all() if image.order != MAIN_IMAGE_ORDER]


class KnownAttendeeSerializer(serializers.Serializer):
    # Public uuid and display name only, never email
    uuid = serializers.UUIDField()
    name = serializers.CharField()


class ExploreOccasionSerializer(UserOccasionSerializer):
    # Attendees the requester has a connection with, by name (see with_known_attendees)
    known_attendees = KnownAttendeeSerializer(many=True, read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "known_attendees")


def with_details(occasions):
    return occasions.annotate(attendees_count=Count("users")).prefetch_related("tags", "images")


def with_known_attendees(occasions, user):
    """Prefetch each occasion's attendees that `user` is connected to into `known_attendees`."""
    connected = Connection.objects.filter(
        Q(user_low=OuterRef("pk"), user_high=user) | Q(user_low=user, user_high=OuterRef("pk"))
    )
    known = User.objects.filter(Exists(connected)).only("uuid", "name").order_by("name")
    return occasions.prefetch_related(Prefetch("users", queryset=known, to_attr="known_attendees"))


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
        def details(occasions):
            return with_known_attendees(with_details(occasions), request.user)

        active_occasion = details(active_occasions(request.user)).order_by("start_datetime").first()
        occasions = []
        if active_occasion is None:
            occasions = details(Occasion.objects.upcoming().exclude(users=request.user)).order_by(
                "start_datetime", "id"
            )[: self.limit]
        return Response(
            {
                "active_occasion": active_occasion and ExploreOccasionSerializer(active_occasion).data,
                "occasions": ExploreOccasionSerializer(occasions, many=True).data,
            }
        )


class JoinOccasionView(APIView):
    """POST /api/occasions/<id>/join/: the requester goes to an upcoming occasion.

    409 while they're going to another occasion that hasn't ended or been cancelled.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, occasion_id):
        occasion = Occasion.objects.upcoming().filter(id=occasion_id).first()
        if occasion is None:
            # Cancelled, over or never existed
            return Response({"detail": "This occasion is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        try:
            join(occasion, request.user)
        except AlreadyGoing as already_going:
            return Response(
                {
                    "detail": f"You're already going to {already_going.occasion.name}. "
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
