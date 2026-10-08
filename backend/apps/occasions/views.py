from datetime import UTC

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
from apps.users.models import FilterPreference, Gender, User

from .models import MAIN_IMAGE_ORDER, Occasion, OccasionTemplate, OccasionUser
from .importing import (
    EventNotRead,
    EventReadFailed,
    ImportUnavailable,
    ensure_free_to_add,
    ensure_import_enabled,
    fetch_event,
    save_imported_occasion,
)
from .services import (
    AlreadyGoing,
    active_occasions,
    create_occasion,
    create_occasion_from_template,
    deactivate_finished,
    join,
)


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


class OccasionTemplateSerializer(serializers.ModelSerializer):
    tags = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")
    # URL of the image every occasion made from it starts with on previews (cards, lists), or null
    main_image = serializers.SerializerMethodField()

    class Meta:
        model = OccasionTemplate
        fields = ("id", "name", "description", "duration_minutes", "tags", "main_image")

    def get_main_image(self, template) -> str | None:
        # Reads the prefetched images, so a list costs no query per template
        main_image = next((image for image in template.images.all() if image.order == MAIN_IMAGE_ORDER), None)
        return main_image.image.url if main_image else None


class TemplateOccasionSerializer(serializers.Serializer):
    """The one thing a user picks when making an occasion from a template: when it starts."""

    start_datetime = serializers.DateTimeField()

    def validate_start_datetime(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("The start must be in the future.")
        return value


class ImportedOccasionSerializer(serializers.ModelSerializer):
    """Checks the fields read from an event's page before the occasion is created."""

    class Meta:
        model = Occasion
        fields = ("name", "description", "start_datetime", "end_datetime")
        extra_kwargs = {"name": {"error_messages": {"blank": "Enter a name."}}}

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter a name.")
        return name

    def validate_start_datetime(self, value):
        # Today is fine: a date without a time is read as midnight, which has already passed
        today_start = timezone.now().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        if value < today_start:
            raise serializers.ValidationError("The start can't be before today.")
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


class EventInvalid(Exception):
    """The event read from a page can't become an occasion (usually it starts in the past)."""

    def __init__(self, messages):
        super().__init__(" ".join(messages))
        self.messages = messages


def validated_import_url(request_data):
    """The link from the request; a bad one raises ValidationError (a 400 under `url`)."""
    url_serializer = OccasionImportSerializer(data=request_data)
    url_serializer.is_valid(raise_exception=True)
    return url_serializer.validated_data["url"]


def validated_event_fields(event):
    """The event's Occasion fields, checked (other keys, like `tag_names`, are ignored); raises EventInvalid."""
    occasion_serializer = ImportedOccasionSerializer(data=event)
    if not occasion_serializer.is_valid():
        raise EventInvalid(
            [message for field_errors in occasion_serializer.errors.values() for message in field_errors]
        )
    return occasion_serializer.validated_data


class OccasionDetailSerializer(UserOccasionSerializer):
    # Gallery image URLs in order, without the main image
    gallery = serializers.SerializerMethodField()
    is_going = serializers.BooleanField(read_only=True)
    # The requester made it, so they can cancel it
    is_mine = serializers.BooleanField(read_only=True)

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "gallery", "is_going", "is_mine")

    def get_gallery(self, occasion) -> list[str]:
        return [image.image.url for image in occasion.images.all() if image.order != MAIN_IMAGE_ORDER]


GenderCountsSerializer = inline_serializer(
    "GenderCounts", {gender.value: serializers.IntegerField() for gender in Gender}
)


class ExploreOccasionSerializer(UserOccasionSerializer):
    # Attendees the requester has a connection with, by name (see with_known_attendees)
    known_attendees = PublicUserSerializer(many=True, read_only=True)
    # How many attendees are men, women or didn't say (see with_details)
    gender_counts = serializers.SerializerMethodField()

    class Meta(UserOccasionSerializer.Meta):
        fields = (*UserOccasionSerializer.Meta.fields, "known_attendees", "gender_counts")

    @extend_schema_field(GenderCountsSerializer)
    def get_gender_counts(self, occasion):
        return {gender.value: getattr(occasion, f"{gender.value}_count") for gender in Gender}


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
        occasions.annotate(
            attendees_count=Count("users"),
            **{f"{gender.value}_count": Count("users", filter=Q(users__gender=gender)) for gender in Gender},
        )
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


class OccasionTemplatesView(APIView):
    """GET /api/occasion-templates/: every template staff made, by name."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="Occasion templates", responses=OccasionTemplateSerializer(many=True))
    def get(self, request):
        templates = OccasionTemplate.objects.prefetch_related("tags", "images")
        return Response(OccasionTemplateSerializer(templates, many=True).data)


class TemplateOccasionView(APIView):
    """POST /api/occasion-templates/<id>/occasions/ {"start_datetime"}: the requester makes an occasion from a template.

    Same as any occasion a regular user makes (see create_occasion): created by them, who goes to it, visible only to
    them and the people directly connected to them. 409 while they're going to another occasion.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Create an occasion from a template",
        request=TemplateOccasionSerializer,
        responses={201: OccasionDetailSerializer, 404: DetailSerializer, 409: DetailSerializer},
    )
    def post(self, request, template_id):
        template = OccasionTemplate.objects.filter(id=template_id).first()
        if template is None:
            return Response({"detail": "This template doesn't exist."}, status=status.HTTP_404_NOT_FOUND)
        start_serializer = TemplateOccasionSerializer(data=request.data)
        start_serializer.is_valid(raise_exception=True)
        try:
            occasion = create_occasion_from_template(
                request.user, template, start_serializer.validated_data["start_datetime"]
            )
        except AlreadyGoing as already_going:
            return already_going_response(already_going.occasion, "add")
        return Response(
            OccasionDetailSerializer(occasion_detail(occasion.id, request.user)).data, status=status.HTTP_201_CREATED
        )


class OccasionDetailView(APIView):
    """GET /api/occasions/<id>/: one occasion with its main image and gallery, for its own page."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="One occasion with its images", responses=OccasionDetailSerializer)
    def get(self, request, occasion_id):
        return Response(OccasionDetailSerializer(occasion_detail(occasion_id, request.user)).data)


class CancelOccasionView(APIView):
    """POST /api/occasions/<id>/cancel/: the creator calls their own occasion off while it's still ahead or running.

    Its attendees can join another occasion right away. 404 for anyone but the creator (also for staff-made ones,
    which only the panel cancels); 400 when it is already cancelled or over.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Cancel an occasion you made",
        request=None,
        responses={200: OccasionDetailSerializer, 400: DetailSerializer, 404: DetailSerializer},
    )
    def post(self, request, occasion_id):
        occasion = Occasion.objects.filter(id=occasion_id, created_by=request.user).first()
        if occasion is None:
            return Response({"detail": "This occasion doesn't exist."}, status=status.HTTP_404_NOT_FOUND)
        if occasion.cancelled_at is not None:
            return Response({"detail": "This occasion was cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        if occasion.ends_at <= timezone.now():
            return Response({"detail": "This occasion is already over."}, status=status.HTTP_400_BAD_REQUEST)
        occasion.cancelled_at = timezone.now()
        occasion.save()
        deactivate_finished()
        return Response(OccasionDetailSerializer(occasion_detail(occasion.id, request.user)).data)


def occasion_detail(occasion_id, user):
    """The occasion, with details and whether `user` is going, or a 404 if they may not see it."""
    going = OccasionUser.objects.filter(occasion=OuterRef("pk"), user=user)
    made_by_user = Occasion.objects.filter(pk=OuterRef("pk"), created_by=user)
    occasions = Occasion.objects.visible_to(user).annotate(is_going=Exists(going), is_mine=Exists(made_by_user))
    return get_object_or_404(with_details(occasions), id=occasion_id)


def already_going_response(occasion, action):
    return Response(
        {
            "detail": f"You're already going to {occasion.name}. "
            f"You can {action} an occasion once it ends or is cancelled."
        },
        status=status.HTTP_409_CONFLICT,
    )


class ImportOccasionView(APIView):
    """POST /api/occasions/import/ {"url"}: Gemini reads the event's page, then the occasion is created from it.

    The only way a regular user adds an occasion; made by them, it's visible only to them and the people directly
    connected to them.

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
        url = validated_import_url(request.data)
        try:
            ensure_free_to_add(request.user)
            ensure_import_enabled()
            event = fetch_event(url)
            occasion_fields = validated_event_fields(event)
            occasion = save_imported_occasion(request.user, occasion_fields, event["tag_names"], event["image_svg"])
        except AlreadyGoing as already_going:
            return already_going_response(already_going.occasion, "add")
        except ImportUnavailable:
            return Response(
                {"detail": "Adding occasions from a link isn't set up on this server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except EventNotRead:
            return Response(
                {"url": ["Couldn't find an event with a title and a start time on that page."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except EventReadFailed:
            return Response(
                {"detail": "Couldn't read that page right now. Try again in a moment."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except EventInvalid as event_invalid:
            # Shown under the link, since that's what the user can change
            return Response(
                {"url": [f"That event can't be added: {event_invalid}"]}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            OccasionDetailSerializer(occasion_detail(occasion.id, request.user)).data, status=status.HTTP_201_CREATED
        )
