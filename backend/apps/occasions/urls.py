from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/occasions/", views.UserOccasionsView.as_view()),
    path("occasions/explore/", views.ExploreOccasionsView.as_view()),
    path("occasions/<int:occasion_id>/", views.OccasionDetailView.as_view()),
    path("occasions/<int:occasion_id>/join/", views.JoinOccasionView.as_view()),
]
