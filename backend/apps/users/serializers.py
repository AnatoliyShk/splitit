from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.tags.models import Tag
from apps.tags.serializers import TagSerializer

from .models import FilterPreference, FilterPreferenceWeekday, User, Weekday


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "uuid",
            "email",
            "name",
            "gender",
            "is_staff",
            "is_superuser",
            "date_joined",
            "adult_confirmed_at",
        )
        read_only_fields = fields


class ProfileSerializer(serializers.ModelSerializer):
    """What users may change about themselves; email and access flags stay fixed."""

    class Meta:
        model = User
        fields = ("name", "gender")
        extra_kwargs = {"name": {"error_messages": {"blank": "Enter your name."}}}

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter your name.")
        return name


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is incorrect.")
        return value

    def validate_new_password(self, value):
        try:
            validate_password(value, self.context["request"].user)
        except DjangoValidationError as validation_error:
            raise serializers.ValidationError(list(validation_error.messages))
        return value


ADULTS_ONLY_MESSAGE = "Splitit is only for people aged 18 or older."
CONFIRM_AGE_MESSAGE = "Confirm that you're 18 or older."


def validate_adult(value):
    """The unticked "I'm 18 or older" box must have been ticked; anything else is refused."""
    if value is not True:
        raise serializers.ValidationError(ADULTS_ONLY_MESSAGE)
    return value


class RegisterSerializer(serializers.ModelSerializer):
    # Declared explicitly to replace the model's default unique check with a case-insensitive one
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    # The sign-up form's "I'm 18 or older" box; must be true. Recorded as adult_confirmed_at
    is_adult = serializers.BooleanField(
        write_only=True, validators=[validate_adult], error_messages={"required": CONFIRM_AGE_MESSAGE}
    )

    class Meta:
        model = User
        fields = ("email", "name", "gender", "password", "is_adult")

    def validate_email(self, value):
        email = User.objects.normalize_email(value)
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate(self, attrs):
        user = User(email=attrs["email"], name=attrs["name"])
        try:
            validate_password(attrs["password"], user)
        except DjangoValidationError as validation_error:
            raise serializers.ValidationError({"password": list(validation_error.messages)})
        return attrs

    def create(self, validated_data):
        validated_data.pop("is_adult")
        return User.objects.create_user(adult_confirmed_at=timezone.now(), **validated_data)


class AgeDeclarationSerializer(serializers.Serializer):
    """An account made before sign-up asked for it: true confirms 18 or older, false closes the account."""

    is_adult = serializers.BooleanField(error_messages={"required": CONFIRM_AGE_MESSAGE})


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            email=User.objects.normalize_email(attrs["email"]),
            password=attrs["password"],
        )
        if user is None:
            raise serializers.ValidationError("Email or password is incorrect.")
        attrs["user"] = user
        return attrs


class FilterPreferenceSerializer(serializers.Serializer):
    """A user's saved Explore filters. Reads tags as {id, name}; writes them as `tag_ids`.

    Saving a list replaces it: an empty list clears that filter. `is_enabled` turns the whole preset
    on or off without touching the lists; when it's left out, it stays as it was.
    """

    tag_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Tag.objects.all(), source="tags", write_only=True
    )
    weekdays = serializers.ListField(child=serializers.ChoiceField(choices=Weekday.choices))
    is_enabled = serializers.BooleanField(required=False)

    def to_representation(self, filter_preference):
        return {
            "tags": TagSerializer(filter_preference.tags.order_by("name"), many=True).data,
            "weekdays": list(filter_preference.weekdays.values_list("weekday", flat=True)),
            "is_enabled": filter_preference.is_enabled,
        }

    @transaction.atomic
    def create(self, validated_data):
        """Saves whichever fields were sent (a PATCH may send only `is_enabled`)."""
        filter_preference, _ = FilterPreference.objects.get_or_create(user=validated_data["user"])
        if "tags" in validated_data:
            filter_preference.tags.set(validated_data["tags"])
        if "weekdays" in validated_data:
            filter_preference.weekdays.all().delete()
            FilterPreferenceWeekday.objects.bulk_create(
                FilterPreferenceWeekday(filter_preference=filter_preference, weekday=weekday)
                for weekday in sorted(set(validated_data["weekdays"]))
            )
        if "is_enabled" in validated_data:
            filter_preference.is_enabled = validated_data["is_enabled"]
        # Also marks the preference as changed when only the child tables did
        filter_preference.save(update_fields=["is_enabled", "updated_at"])
        return filter_preference
