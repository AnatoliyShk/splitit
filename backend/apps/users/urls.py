from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.CsrfView.as_view()),
    path("me/", views.MeView.as_view()),
    path("password/", views.PasswordView.as_view()),
    path("register/", views.RegisterView.as_view()),
    path("age/", views.AgeView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("logout/", views.LogoutView.as_view()),
]

# REST resources nested under a user, mounted at /api/
user_urlpatterns = [
    path("users/<uuid:user_uuid>/filter-preference/", views.FilterPreferenceView.as_view()),
]
