from rest_framework import serializers

from apps.events.models import Event
from apps.tags.models import Tag
from apps.users.models import User


class PanelUserSerializer(serializers.ModelSerializer):
    events_count = serializers.IntegerField(read_only=True)

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
            "events_count",
        )
        # Admins can only switch access flags; profile data stays the user's own
        read_only_fields = ("id", "email", "name", "is_superuser", "date_joined", "last_login")


class AttendeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "email")


class PanelEventSerializer(serializers.ModelSerializer):
    # Write attendees as a list of user ids, read them back with names
    users = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), many=True, required=False, write_only=True
    )
    attendees = AttendeeSerializer(source="users", many=True, read_only=True)
    duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = (
            "id",
            "name",
            "start_datetime",
            "end_datetime",
            "duration_minutes",
            "users",
            "attendees",
            "created_at",
            "updated_at",
        )

    def get_duration_minutes(self, event) -> int | None:
        duration = event.duration
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
    events_count = serializers.SerializerMethodField()

    class Meta:
        model = Tag
        fields = ("id", "name", "events_count", "created_at", "updated_at")

    def get_events_count(self, tag) -> int:
        # Annotated on list/detail queries; a freshly created tag isn't, so count directly
        count = getattr(tag, "events_count", None)
        return tag.events.count() if count is None else count

    def validate_name(self, value):
        name = value.strip()
        duplicates = Tag.objects.filter(name__iexact=name)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("A tag with this name already exists.")
        return name
