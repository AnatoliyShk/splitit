from django.contrib.auth import login, logout, update_session_auth_hash
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .serializers import (
    LoginSerializer,
    PasswordChangeSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    """DRF only checks CSRF for logged-in users; also check it for anonymous ones to block login CSRF."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            self.enforce_csrf(request)
        return result


class AuthView(APIView):
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    permission_classes = [AllowAny]


class CsrfView(AuthView):
    """Sets the csrftoken cookie the frontend sends back in the X-CSRFToken header."""

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(AuthView):
    def get(self, request):
        user = UserSerializer(request.user).data if request.user.is_authenticated else None
        return Response({"user": user})

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

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response({"user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)


class LoginView(AuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response({"user": UserSerializer(user).data})


class LogoutView(AuthView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
