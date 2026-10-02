from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/events/", views.UserEventsView.as_view()),
]
