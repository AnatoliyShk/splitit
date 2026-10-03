from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/events/", views.UserEventsView.as_view()),
    path("events/explore/", views.ExploreEventsView.as_view()),
    path("events/<int:event_id>/join/", views.JoinEventView.as_view()),
]
