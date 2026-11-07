"""HTTP helpers for API-facing functions: JSON responses with CORS headers, typed errors, request parsing,
and a small router that dispatches on API Gateway's (httpMethod, resource) pair."""

import base64
import json
import logging
import os
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


class ApiError(Exception):
    """An error with a status code and a message that is safe to show to the user."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class BadRequest(ApiError):
    def __init__(self, message: str, code: str = "BAD_REQUEST"):
        super().__init__(400, code, message)


class Unauthorized(ApiError):
    def __init__(self, message: str = "Sign in to continue."):
        super().__init__(401, "UNAUTHORIZED", message)


class Forbidden(ApiError):
    def __init__(self, message: str = "You don't have access to this."):
        super().__init__(403, "FORBIDDEN", message)


class NotFound(ApiError):
    def __init__(self, message: str = "Not found."):
        super().__init__(404, "NOT_FOUND", message)


class Gone(ApiError):
    def __init__(self, message: str = "This syllabus was removed after its retention period ended."):
        super().__init__(410, "EXPIRED", message)


class Conflict(ApiError):
    def __init__(self, message: str, code: str = "CONFLICT"):
        super().__init__(409, code, message)


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    }


def respond(status: int, body=None) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **cors_headers()},
        "body": json.dumps(body if body is not None else {}, default=_json_default),
    }


def parse_json_body(event: dict) -> dict:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BadRequest("The request body must be valid JSON.") from exc
    if not isinstance(data, dict):
        raise BadRequest("The request body must be a JSON object.")
    return data


def path_param(event: dict, name: str) -> str:
    value = (event.get("pathParameters") or {}).get(name)
    if not value:
        raise BadRequest(f"Missing path parameter: {name}.")
    return value


def int_path_param(event: dict, name: str) -> int:
    value = path_param(event, name)
    try:
        number = int(value)
    except ValueError as exc:
        raise BadRequest(f"{name} must be a whole number.") from exc
    if number < 1:
        raise BadRequest(f"{name} must be 1 or greater.")
    return number


def required_str(body: dict, field: str, max_len: int) -> str:
    value = body.get(field)
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"{field} is required.")
    value = value.strip()
    if len(value) > max_len:
        raise BadRequest(f"{field} must be {max_len} characters or fewer.")
    return value


def optional_str(body: dict, field: str, max_len: int):
    value = body.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise BadRequest(f"{field} must be text.")
    value = value.strip()
    if len(value) > max_len:
        raise BadRequest(f"{field} must be {max_len} characters or fewer.")
    return value


def route(handlers: dict):
    """Return a Lambda handler that dispatches API Gateway proxy events to handlers[(method, resource)].

    Handlers receive the event and return a response from respond(). ApiError becomes a JSON error
    response; anything else is logged and becomes a generic 500 so internals never leak to the browser.
    """

    def handler(event, context):
        method = event.get("httpMethod")
        resource = event.get("resource")
        request_id = getattr(context, "aws_request_id", None)
        fn = handlers.get((method, resource))
        if fn is None:
            return respond(404, {"code": "NOT_FOUND", "message": f"No route for {method} {resource}.", "requestId": request_id})
        try:
            return fn(event)
        except ApiError as err:
            if err.status >= 500:
                logger.error("API error %s: %s", err.code, err.message)
            return respond(err.status, {"code": err.code, "message": err.message, "requestId": request_id})
        except Exception:
            logger.exception("Unhandled error on %s %s", method, resource)
            return respond(500, {"code": "INTERNAL", "message": "Something went wrong. Please try again.", "requestId": request_id})

    return handler
