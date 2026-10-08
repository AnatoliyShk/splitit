import logging

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_field, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.connections.models import Connection
from apps.users.access import user_from_url
from apps.tags.models import Tag
from apps.users.models import FilterPreference, User

from .models import MAIN_IMAGE_ORDER, Occasion, OccasionImage, OccasionUser
from .importing import EventNotRead, read_event, upsert_tags
from .services import AlreadyGoing, active_occasions, create_occasion, join

logger = logging.getLogger(__name__)


class PublicUserSerializer(serializers.Serializer):
    # Public uuid and display name only, never email
    uuid = serializers.UUIDField()
    name = serializers.CharField()


class UserOccasionSerializer(serializers.ModelSerializer):
    attendees_count = serializers.IntegerField(read_only=True)
    tags = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")
    # URL of the image shown on previews (cards, lists), or null
    main_image = serializers.SerializerMethodField()
    # The regular user who made it; null when staff made it (or it predates creators being recorded)
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = Occasion
        fields = (
            "id",
            "name",
            "description",
            "start_datetime",
            "end_datetime",
            "cancelled_at",
            "attendees_count",
            "tags",
            "main_image",
            "created_by",
        )

    def get_main_image(self, occasion) -> str | None:
        # Reads the prefetched images (see with_details), so a list costs no query per occasion
        main_image = next((image for image in occasion.images.all() if image.order == MAIN_IMAGE_ORDER), None)
        return main_image.image.url if main_image else None

    @extend_schema_field(PublicUserSerializer(allow_null=True))
    def get_created_by(self, occasion):
        creator = occasion.created_by
        if creator is None or creator.is_staff:
            return None
        return PublicUserSerializer(creator).data


class OccasionCreateSerializer(serializers.ModelSerializer):
    """What a regular user sends to create an occasion; tags as ids."""

    tag_ids = serializers.PrimaryKeyRelatedField(
        source="tags", queryset=Tag.objects.all(), many=True, required=False
    )

    class Meta:
        model = Occasion
        fields = ("name", "description", "start_datetime", "end_datetime", "tag_ids")
        extra_kwargs = {"name": {"error_messages": {"blank": "Enter a name."}}}

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter a name.")
        return name

    def validate_start_datetime(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("The start must be in the future.")
        return value

    def validate(self, attrs):
        # Mirrors the model's check constraint so it returns a 400 instead of a database error
        end = attrs.get("end_datetime")
        if end and end <= attrs["start_datetime"]:
            raise serializers.ValidationError({"end_datetime": "The end must be after the start."})
        return attrs


class OccasionImportSerializer(serializers.Serializer):
    url = serializers.URLField(error_messages={"invalid": "Enter a link to the event's page, starting with https://."})

    def validate_url(self, value):
        if not value.lower().startswith(("http://", "https://")):
            raise serializers.ValidationError("Enter a link to the event's page, starting with https://.")
        return value


class OccasionDetailSerializer(UserOccasionSerializer):
    # Gallery image URLs in order, without the main image
    gallery = serializers.SerializerMethodField()
    is_going = serializers.BooleanField(read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "gallery", "is_going")

    def get_gallery(self, occasion) -> list[str]:
        return [image.image.url for image in occasion.images.all() if image.order != MAIN_IMAGE_ORDER]


class ExploreOccasionSerializer(UserOccasionSerializer):
    # Attendees the requester has a connection with, by name (see with_known_attendees)
    known_attendees = PublicUserSerializer(many=True, read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "known_attendees")


DetailSerializer = inline_serializer("Detail", {"detail": serializers.CharField()})
ExploreResponseSerializer = inline_serializer(
    "ExploreResponse",
    {
        "active_occasion": ExploreOccasionSerializer(allow_null=True),
        "occasions": ExploreOccasionSerializer(many=True),
    },
)


def with_details(occasions):
    return (
        occasions.annotate(attendees_count=Count("users"))
        .select_related("created_by")
        .prefetch_related("tags", "images")
    )


def with_known_attendees(occasions, user):
    """Prefetch each occasion's attendees that `user` is connected to into `known_attendees`."""
    connected = Connection.objects.filter(
        Q(user_low=OuterRef("pk"), user_high=user) | Q(user_low=user, user_high=OuterRef("pk"))
    )
    known = User.objects.filter(Exists(connected)).only("uuid", "name").order_by("name")
    return occasions.prefetch_related(Prefetch("users", queryset=known, to_attr="known_attendees"))


def matching_filter_preference(occasions, user):
    """Narrow occasions to the user's saved Explore filters: any of their tags, starting on one of their weekdays.

    An empty list doesn't filter, and neither does having nothing saved or turning the filters off.
    """
    filter_preference = FilterPreference.objects.filter(user=user).first()
    if filter_preference is None or not filter_preference.is_enabled:
        return occasions
    tag_ids = list(filter_preference.tags.values_list("id", flat=True))
    weekdays = list(filter_preference.weekdays.values_list("weekday", flat=True))
    if tag_ids:
        # Exists rather than a join, so an occasion with two matching tags isn't listed twice
        tagged = Tag.occasions.through.objects.filter(occasion=OuterRef("pk"), tag_id__in=tag_ids)
        occasions = occasions.filter(Exists(tagged))
    if weekdays:
        # In the server's TIME_ZONE (UTC)
        occasions = occasions.filter(start_datetime__iso_week_day__in=weekdays)
    return occasions


class UserOccasionsView(APIView):
    """GET /api/users/<uuid>/occasions/: occasions that user is going to, soonest first."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="Occasions a user is going to", responses=UserOccasionSerializer(many=True))
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
    Otherwise it lists upcoming occasions the requester may see (see OccasionQuerySet.visible_to) and isn't
    going to yet that match their saved filters, soonest first.
    """

    permission_classes = [IsAuthenticated]
    limit = 50

    @extend_schema(summary="Your active occasion, or upcoming ones to join", responses=ExploreResponseSerializer)
    def get(self, request):
        def details(occasions):
            return with_known_attendees(with_details(occasions), request.user)

        active_occasion = details(active_occasions(request.user)).order_by("start_datetime").first()
        occasions = []
        if active_occasion is None:
            upcoming_occasions = matching_filter_preference(
                Occasion.objects.upcoming().visible_to(request.user).exclude(users=request.user), request.user
            )
            occasions = details(upcoming_occasions).order_by("start_datetime", "id")[: self.limit]
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

    @extend_schema(
        summary="Go to an upcoming occasion",
        request=None,
        responses={204: None, 404: DetailSerializer, 409: DetailSerializer},
    )
    def post(self, request, occasion_id):
        occasion = Occasion.objects.upcoming().visible_to(request.user).filter(id=occasion_id).first()
        if occasion is None:
            # Cancelled, over, never existed or not visible to the requester
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

    @extend_schema(summary="One occasion with its images", responses=OccasionDetailSerializer)
    def get(self, request, occasion_id):
        return Response(OccasionDetailSerializer(occasion_detail(occasion_id, request.user)).data)


def occasion_detail(occasion_id, user):
    """The occasion, with details and whether `user` is going, or a 404 if they may not see it."""
    going = OccasionUser.objects.filter(occasion=OuterRef("pk"), user=user)
    occasions = Occasion.objects.visible_to(user).annotate(is_going=Exists(going))
    return get_object_or_404(with_details(occasions), id=occasion_id)


class CreateOccasionView(APIView):
    """POST /api/occasions/: the requester creates an occasion and goes to it.

    Made by a regular user, it's visible only to them and the people directly connected to them.
    409 while they're going to another occasion (nothing is created).
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Create an occasion and go to it",
        request=OccasionCreateSerializer,
        responses={201: OccasionDetailSerializer, 409: DetailSerializer},
    )
    def post(self, request):
        serializer = OccasionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = dict(serializer.validated_data)
        tags = fields.pop("tags", [])
        try:
            occasion = create_occasion(request.user, tags, **fields)
        except AlreadyGoing as already_going:
            return already_going_response(already_going.occasion, "create")
        return Response(
            OccasionDetailSerializer(occasion_detail(occasion.id, request.user)).data, status=status.HTTP_201_CREATED
        )


def already_going_response(occasion, action):
    return Response(
        {
            "detail": f"You're already going to {occasion.name}. "
            f"You can {action} an occasion once it ends or is cancelled."
        },
        status=status.HTTP_409_CONFLICT,
    )


class ImportOccasionView(APIView):
    """POST /api/occasions/import/ {"url"}: Gemini reads the event's page, then it's created like POST /api/occasions/.

    The reply's tags are matched to existing ones ignoring case, and the missing ones created; the occasion is
    created by the requester, who goes to it, with a link-preview card (preview.py) as its main image.
    URL errors (including "no event found there") come back under `url`.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "occasion_import"

    @extend_schema(
        summary="Create an occasion from an event's web page",
        request=OccasionImportSerializer,
        responses={201: OccasionDetailSerializer, 409: DetailSerializer, 502: DetailSerializer, 503: DetailSerializer},
    )
    def post(self, request):
        url_serializer = OccasionImportSerializer(data=request.data)
        url_serializer.is_valid(raise_exception=True)
        # Checked before asking Gemini, so a doomed import doesn't spend a call
        active_occasion = active_occasions(request.user).order_by("start_datetime").first()
        if active_occasion is not None:
            return already_going_response(active_occasion, "add")
        if not settings.GEMINI_API_KEY:
            return Response(
                {"detail": "Adding occasions from a link isn't set up on this server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            event = read_event(url_serializer.validated_data["url"])
        except EventNotRead:
            return Response(
                {"url": ["Couldn't find an event with a title and a start time on that page."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception("Reading an event from a link failed")
            return Response(
                {"detail": "Couldn't read that page right now. Try again in a moment."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        tag_names = event.pop("tag_names")
        image_svg = event.pop("image_svg")
        occasion_serializer = OccasionCreateSerializer(data=event)
        if not occasion_serializer.is_valid():
            # Usually a start in the past; shown under the link, since that's what the user can change
            messages = [message for field_errors in occasion_serializer.errors.values() for message in field_errors]
            return Response(
                {"url": [f"That event can't be added: {' '.join(messages)}"]}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # One transaction, so tags made for an occasion that then fails to save are rolled back with it
            with transaction.atomic():
                tags = upsert_tags(tag_names)
                occasion = create_occasion(request.user, tags, **occasion_serializer.validated_data)
                # Its link-preview card becomes the main image (cards, lists, the top of its page)
                OccasionImage.objects.create(
                    occasion=occasion, order=MAIN_IMAGE_ORDER, image=ContentFile(image_svg, name="preview.svg")
                )
        except AlreadyGoing as already_going:
            return already_going_response(already_going.occasion, "add")
        return Response(
            OccasionDetailSerializer(occasion_detail(occasion.id, request.user)).data, status=status.HTTP_201_CREATED
        )
