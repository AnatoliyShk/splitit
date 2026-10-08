from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/occasions/", views.UserOccasionsView.as_view()),
    path("occasions/explore/", views.ExploreOccasionsView.as_view()),
    path("occasions/import/", views.ImportOccasionView.as_view()),
    path("occasion-templates/", views.OccasionTemplatesView.as_view()),
    path("occasion-templates/<int:template_id>/occasions/", views.TemplateOccasionView.as_view()),
    path("occasions/<int:occasion_id>/", views.OccasionDetailView.as_view()),
    path("occasions/<int:occasion_id>/join/", views.JoinOccasionView.as_view()),
    path("occasions/<int:occasion_id>/cancel/", views.CancelOccasionView.as_view()),
]
