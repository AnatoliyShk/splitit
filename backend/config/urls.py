from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    # /admin is the React control panel; Django's built-in admin lives here instead
    path("django-admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/auth/", include("apps.users.urls")),
    # REST resources nested under a user: /api/users/<uuid>/occasions/, .../connections/
    path("api/", include("apps.occasions.urls")),
    path("api/", include("apps.connections.urls")),
    path("api/panel/", include("apps.panel.urls")),
    # Uploaded images; static() serves nothing unless DEBUG is on
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
