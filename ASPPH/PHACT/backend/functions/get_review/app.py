"""GetReview: GET /reviews/{id}, polled every few seconds while a review runs.

Returns the review's status and stage; once COMPLETED, also its results (grading or recommendations, plus
the diff). A review stuck in QUEUED or RUNNING for over 15 minutes is reported as FAILED (timed out).
"""

from phact import auth, reviews
from phact.http import path_param, respond, route


def get_review(event):
    review = reviews.get_owned_review(path_param(event, "id"), auth.user_id(event))
    return respond(200, reviews.view(review))


handler = route({("GET", "/reviews/{id}"): get_review})
