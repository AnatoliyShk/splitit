from django.contrib.auth import login, logout, update_session_auth_hash
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.tags.serializers import TagSerializer

from .access import user_from_url
from .models import FilterPreference
from .serializers import (
    FilterPreferenceSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)


# Response shapes for the API docs; the views build these dicts by hand
UserResponseSerializer = inline_serializer("UserResponse", {"user": UserSerializer()})
MaybeUserResponseSerializer = inline_serializer("MaybeUserResponse", {"user": UserSerializer(allow_null=True)})
FilterPreferenceResponseSerializer = inline_serializer(
    "FilterPreferenceResponse",
    {
        "tags": TagSerializer(many=True),
        "weekdays": serializers.ListField(child=serializers.IntegerField(min_value=1, max_value=7)),
        "is_enabled": serializers.BooleanField(),
    },
)


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    """DRF only checks CSRF for logged-in users; also check it for anonymous ones to block login CSRF."""

    def authenticate(self, request):
        user_and_auth = super().authenticate(request)
        if user_and_auth is None:
            self.enforce_csrf(request)
        return user_and_auth


class AuthView(APIView):
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    permission_classes = [AllowAny]


class CsrfView(AuthView):
    """Sets the csrftoken cookie the frontend sends back in the X-CSRFToken header."""

    @extend_schema(summary="Set the CSRF cookie", responses={204: None})
    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(AuthView):
    @extend_schema(summary="The logged-in user, or null", responses=MaybeUserResponseSerializer)
    def get(self, request):
        user = UserSerializer(request.user).data if request.user.is_authenticated else None
        return Response({"user": user})

    @extend_schema(summary="Change your name", request=ProfileSerializer, responses=UserResponseSerializer)
    def patch(self, request):
        if not request.user.is_authenticated:
            raise NotAuthenticated()
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"user": UserSerializer(request.user).data})


class PasswordView(AuthView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(summary="Change your password", request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        # Changing the password invalidates other sessions; keep this one logged in
        update_session_auth_hash(request, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RegisterView(AuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        summary="Create an account and log in", request=RegisterSerializer, responses={201: UserResponseSerializer}
    )
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response({"user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)


class LoginView(AuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(summary="Log in", request=LoginSerializer, responses=UserResponseSerializer)
    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response({"user": UserSerializer(user).data})


class LogoutView(AuthView):
    @extend_schema(summary="Log out", request=None, responses={204: None})
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FilterPreferenceView(APIView):
    """GET/PUT/PATCH /api/users/<uuid>/filter-preference/: the Explore filters that user saved.

    With nothing saved yet, GET returns empty lists (no filters). PUT replaces both lists;
    PATCH changes only the fields sent, e.g. {"is_enabled": false} to turn the filters off.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="A user's saved Explore filters", responses=FilterPreferenceResponseSerializer)
    def get(self, request, user_uuid):
        user = user_from_url(request, user_uuid)
        filter_preference = FilterPreference.objects.filter(user=user).first()
        if filter_preference is None:
            return Response({"tags": [], "weekdays": [], "is_enabled": True})
        return Response(FilterPreferenceSerializer(filter_preference).data)

    @extend_schema(
        summary="Replace a user's saved Explore filters",
        request=FilterPreferenceSerializer,
        responses=FilterPreferenceResponseSerializer,
    )
    def put(self, request, user_uuid):
        return self.save(request, user_uuid, partial=False)

    @extend_schema(
        summary="Change some of a user's saved Explore filters, e.g. turn them on or off",
        request=FilterPreferenceSerializer(partial=True),
        responses=FilterPreferenceResponseSerializer,
    )
    def patch(self, request, user_uuid):
        return self.save(request, user_uuid, partial=True)

    def save(self, request, user_uuid, partial):
        user = user_from_url(request, user_uuid)
        serializer = FilterPreferenceSerializer(data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        filter_preference = serializer.save(user=user)
        return Response(FilterPreferenceSerializer(filter_preference).data)
