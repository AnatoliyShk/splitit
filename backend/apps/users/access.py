from django.http import Http404
from django.shortcuts import get_object_or_404

from .models import User


def user_from_url(request, user_uuid):
    """The user a /api/users/<uuid>/... URL points at, if the requester may see their data.

    People see their own data and staff see anyone's. Everyone else gets a 404, so the URL
    doesn't reveal whether that user exists.
    """
    if not (request.user.is_staff or request.user.uuid == user_uuid):
        raise Http404
    return get_object_or_404(User, uuid=user_uuid)
