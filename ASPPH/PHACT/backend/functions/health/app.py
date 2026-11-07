"""Health function: GET /health, no sign-in required. Used to confirm a deploy is reachable."""

from phact.http import respond, route


def health(event):
    return respond(200, {"status": "ok", "service": "phact"})


handler = route({("GET", "/health"): health})
