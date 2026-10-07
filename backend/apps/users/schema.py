from drf_spectacular.authentication import SessionScheme


class CsrfEnforcedSessionScheme(SessionScheme):
    """Documents the auth views' authentication: the same session cookie, with CSRF checked even when logged out.

    drf-spectacular needs a distinct name per authentication class, hence not "cookieAuth".
    """

    target_class = "apps.users.views.CsrfEnforcedSessionAuthentication"
    name = "csrfCookieAuth"
