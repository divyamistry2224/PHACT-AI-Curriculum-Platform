"""Reads the caller's identity from the claims API Gateway's Cognito authorizer attaches to each request."""

from .http import Forbidden, Unauthorized

ADMIN_GROUP = "admin"
FACULTY_GROUP = "faculty"


def claims(event: dict) -> dict:
    return ((event.get("requestContext") or {}).get("authorizer") or {}).get("claims") or {}


def user_id(event: dict) -> str:
    """The caller's Cognito user ID (sub). Every record a faculty member owns is keyed to this value."""
    sub = claims(event).get("sub")
    if not sub:
        raise Unauthorized()
    return sub


def email(event: dict):
    return claims(event).get("email")


def groups(event: dict) -> set:
    """Cognito groups for the caller.

    The REST API authorizer passes cognito:groups as a single string. Depending on the number of groups it
    can look like "admin", "admin,faculty", or "[admin faculty]", so all three shapes are handled.
    """
    raw = claims(event).get("cognito:groups") or ""
    items = raw if isinstance(raw, list) else raw.strip("[]").replace(",", " ").split()
    return {item.strip() for item in items if item and item.strip()}


def is_admin(event: dict) -> bool:
    return ADMIN_GROUP in groups(event)


def require_admin(event: dict) -> str:
    """Raise 403 unless the caller is in the admin group. Returns the caller's user ID."""
    uid = user_id(event)
    if not is_admin(event):
        raise Forbidden("This page is only available to ASPPH administrators.")
    return uid
