from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("users", views.UserViewSet, basename="panel-user")
router.register("events", views.EventViewSet, basename="panel-event")
router.register("tags", views.TagViewSet, basename="panel-tag")

urlpatterns = [
    path("stats/", views.StatsView.as_view()),
    *router.urls,
]
