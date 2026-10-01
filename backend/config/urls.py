from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    # /admin is the React control panel; Django's built-in admin lives here instead
    path("django-admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/auth/", include("apps.users.urls")),
    path("api/panel/", include("apps.panel.urls")),
]
