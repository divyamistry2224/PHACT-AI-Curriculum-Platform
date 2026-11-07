"""DecideReview function: the faculty member's decisions on a review's suggestions.

POST /reviews/{id}/decisions   Body {decisions: [{hunkId, accept, text?}]}

Accepted changes (with any edits, which are safety-checked and purged of personal details) become the next
version. Declining everything closes the proposal without a new version. See phact/reviews.py.
"""

from phact import reviews
from phact.http import route

handler = route({("POST", "/reviews/{id}/decisions"): reviews.decide})
