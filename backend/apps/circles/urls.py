from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/circles/", views.UserCirclesView.as_view()),
]
