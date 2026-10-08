from django.http import JsonResponse

# Still open to a logged-in user who hasn't confirmed their age: logging in and out, the session check, the
# confirmation itself (all under /api/auth/) and the health check
OPEN_PATHS = ("/api/auth/", "/api/health/")


class AdultConfirmationMiddleware:
    """Splitit is for adults only: an account with no recorded "I'm 18 or older" declaration (one made before
    sign-up asked for it) gets a 403 from the API until it confirms at POST /api/auth/age/.

    Runs after AuthenticationMiddleware, so it covers every API view, the staff panel's included, in one place.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = request.user
        if (
            request.path.startswith("/api/")
            and not request.path.startswith(OPEN_PATHS)
            and user.is_authenticated
            and user.adult_confirmed_at is None
        ):
            return JsonResponse(
                {
                    "detail": "Confirm that you're 18 or older to keep using Splitit.",
                    "code": "age_confirmation_required",
                },
                status=403,
            )
        return self.get_response(request)
