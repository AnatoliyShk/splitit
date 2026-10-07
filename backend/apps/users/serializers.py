from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.tags.models import Tag
from apps.tags.serializers import TagSerializer

from .models import FilterPreference, FilterPreferenceWeekday, User, Weekday


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "uuid", "email", "name", "is_staff", "is_superuser", "date_joined")
        read_only_fields = fields


class ProfileSerializer(serializers.ModelSerializer):
    """What users may change about themselves; email and access flags stay fixed."""

    class Meta:
        model = User
        fields = ("name",)
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


class RegisterSerializer(serializers.ModelSerializer):
    # Declared explicitly to replace the model's default unique check with a case-insensitive one
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    class Meta:
        model = User
        fields = ("email", "name", "password")

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
        return User.objects.create_user(**validated_data)


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

    Saving replaces both lists: an empty list clears that filter.
    """

    tag_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Tag.objects.all(), source="tags", write_only=True
    )
    weekdays = serializers.ListField(child=serializers.ChoiceField(choices=Weekday.choices))

    def to_representation(self, filter_preference):
        return {
            "tags": TagSerializer(filter_preference.tags.order_by("name"), many=True).data,
            "weekdays": list(filter_preference.weekdays.values_list("weekday", flat=True)),
        }

    @transaction.atomic
    def create(self, validated_data):
        filter_preference, _ = FilterPreference.objects.get_or_create(user=validated_data["user"])
        filter_preference.tags.set(validated_data["tags"])
        filter_preference.weekdays.all().delete()
        FilterPreferenceWeekday.objects.bulk_create(
            FilterPreferenceWeekday(filter_preference=filter_preference, weekday=weekday)
            for weekday in sorted(set(validated_data["weekdays"]))
        )
        # The rows that changed are in the child tables; this marks the preference as changed too
        filter_preference.save(update_fields=["updated_at"])
        return filter_preference
