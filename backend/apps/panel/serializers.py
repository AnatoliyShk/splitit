from rest_framework import serializers

from apps.occasions.models import MAX_IMAGE_ORDER, Occasion, OccasionImage
from apps.tags.models import Tag
from apps.users.models import User


class PanelUserSerializer(serializers.ModelSerializer):
    occasions_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "name",
            "is_active",
            "is_staff",
            "is_superuser",
            "date_joined",
            "last_login",
            "occasions_count",
        )
        # Admins can only switch access flags; profile data stays the user's own
        read_only_fields = ("id", "email", "name", "is_superuser", "date_joined", "last_login")


class AttendeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "email")


class OccasionTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ("id", "name")


class PanelOccasionImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = OccasionImage
        fields = ("order", "url")

    def get_url(self, image) -> str:
        # A site-relative /media/... path, like the public API (ImageField would make it absolute)
        return image.image.url


# Uploads larger than this are refused, so the gallery stays quick to load
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


class OccasionImageUploadSerializer(serializers.Serializer):
    """POST body (multipart) for /api/admin/occasions/<id>/images/: the file and the slot it goes in."""

    order = serializers.IntegerField(min_value=0, max_value=MAX_IMAGE_ORDER)
    image = serializers.ImageField()

    def validate_image(self, value):
        if value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError("The image must be 5 MB or smaller.")
        # Pillow has already opened the file to check it's an image; this narrows it to web formats
        if getattr(getattr(value, "image", None), "format", None) not in IMAGE_FORMATS:
            raise serializers.ValidationError("Use a JPEG, PNG or WebP image.")
        return value


class PanelOccasionSerializer(serializers.ModelSerializer):
    # Write attendees as a list of user ids, read them back with names
    users = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), many=True, required=False, write_only=True
    )
    attendees = AttendeeSerializer(source="users", many=True, read_only=True)
    # Same for tags: written as ids, read back with names
    tag_ids = serializers.PrimaryKeyRelatedField(
        source="tags", queryset=Tag.objects.all(), many=True, required=False, write_only=True
    )
    tags = serializers.SerializerMethodField()
    # Order 0 is the main image; 1-3 the gallery. Changed through the images endpoints, not here
    images = PanelOccasionImageSerializer(many=True, read_only=True)
    duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = Occasion
        fields = (
            "id",
            "name",
            "description",
            "start_datetime",
            "end_datetime",
            "duration_minutes",
            "cancelled_at",
            "users",
            "attendees",
            "tag_ids",
            "tags",
            "images",
            "created_at",
            "updated_at",
        )

    def get_tags(self, occasion) -> list[dict]:
        # Sorted here rather than in the query, so a just-saved occasion comes back in the same order
        tags = sorted(occasion.tags.all(), key=lambda tag: tag.name.lower())
        return OccasionTagSerializer(tags, many=True).data

    def get_duration_minutes(self, occasion) -> int | None:
        duration = occasion.duration
        return None if duration is None else int(duration.total_seconds() // 60)

    def validate(self, attrs):
        # Mirrors the model's check constraint so it returns a 400 instead of a database error
        start = attrs.get("start_datetime", getattr(self.instance, "start_datetime", None))
        if "end_datetime" in attrs:
            end = attrs["end_datetime"]
        else:
            end = getattr(self.instance, "end_datetime", None)
        if start and end and end <= start:
            raise serializers.ValidationError({"end_datetime": "The end must be after the start."})
        return attrs


class PanelTagSerializer(serializers.ModelSerializer):
    occasions_count = serializers.SerializerMethodField()
    has_embedding = serializers.SerializerMethodField()

    class Meta:
        model = Tag
        fields = ("id", "name", "occasions_count", "has_embedding", "created_at", "updated_at")

    def get_occasions_count(self, tag) -> int:
        # Annotated on list/detail queries; a freshly created tag isn't, so count directly
        count = getattr(tag, "occasions_count", None)
        return tag.occasions.count() if count is None else count

    def get_has_embedding(self, tag) -> bool:
        return tag.embedding is not None

    def validate_name(self, value):
        name = value.strip()
        duplicates = Tag.objects.filter(name__iexact=name)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("A tag with this name already exists.")
        return name
