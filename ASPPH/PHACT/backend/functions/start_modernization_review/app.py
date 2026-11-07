"""StartModernizationReview: POST /syllabi/{id}/modernization-reviews.

Takes the syllabus's review lock, records a QUEUED review on the current version, and puts it on the
modernization queue. Returns 202 with the review; the page then polls GET /reviews/{reviewId}.
"""

from phact import reviews
from phact.http import route

handler = route({("POST", "/syllabi/{id}/modernization-reviews"): lambda event: reviews.start(event, "MODERNIZATION")})
