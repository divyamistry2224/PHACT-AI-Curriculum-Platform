"""UndoReview: POST /reviews/{id}/undo.

Deletes the version this review created and makes the previous version current again. Only the most recent
review can be undone, never while another review is running, and never while that version awaits approval.
"""

from phact import reviews
from phact.http import route

handler = route({("POST", "/reviews/{id}/undo"): reviews.undo})
