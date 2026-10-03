from django.urls import path

from . import views

urlpatterns = [
    path("users/<uuid:user_uuid>/connections/", views.UserConnectionsView.as_view()),
    path("users/<uuid:user_uuid>/connections/graph/", views.UserConnectionsGraphView.as_view()),
]
