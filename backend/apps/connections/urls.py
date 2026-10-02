from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/connections/", views.UserConnectionsView.as_view()),
]
