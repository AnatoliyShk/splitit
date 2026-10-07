from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.permissions import IsAdminUser

from apps.users.urls import user_urlpatterns

urlpatterns = [
    # /admin is the React control panel; Django's built-in admin lives here instead
    path("django-admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/auth/", include("apps.users.urls")),
    path("api/", include(user_urlpatterns)),
    path("api/", include("apps.tags.urls")),
    # REST resources nested under a user: /api/users/<uuid>/occasions/, .../connections/, .../filter-preference/
    path("api/", include("apps.occasions.urls")),
    path("api/", include("apps.connections.urls")),
    # Staff-only API behind the React control panel at /admin; never in the public docs
    path("api/admin/", include("apps.panel.urls")),
    # OpenAPI schema and Swagger UI (see SPECTACULAR_SETTINGS for who may open them)
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    # The admin API's own docs, staff only even while DEBUG is on
    path(
        "api/admin/schema/",
        SpectacularAPIView.as_view(
            permission_classes=[IsAdminUser],
            custom_settings={
                "TITLE": "Splitit admin API",
                "DESCRIPTION": "Staff-only endpoints behind the React control panel at /admin.",
                "PREPROCESSING_HOOKS": ["config.schema.admin_endpoints"],
            },
        ),
        name="admin-schema",
    ),
    path(
        "api/admin/docs/",
        SpectacularSwaggerView.as_view(url_name="admin-schema", permission_classes=[IsAdminUser]),
        name="admin-swagger-ui",
    ),
    # Uploaded images, served by Django itself (fine at this scale; MEDIA_ROOT should be on a volume in production)
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
