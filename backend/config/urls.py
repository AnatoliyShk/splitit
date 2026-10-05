from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    # /admin is the React control panel; Django's built-in admin lives here instead
    path("django-admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/auth/", include("apps.users.urls")),
    # REST resources nested under a user: /api/users/<uuid>/occasions/, .../connections/
    path("api/", include("apps.occasions.urls")),
    path("api/", include("apps.connections.urls")),
    path("api/panel/", include("apps.panel.urls")),
    # Uploaded images, served by Django itself (fine at this scale; MEDIA_ROOT should be on a volume in production)
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
