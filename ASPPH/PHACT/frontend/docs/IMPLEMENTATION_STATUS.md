# PHACT front end implementation status

## Live (calls the PHACT API)

- Cognito sign-in with token refresh; roles from Cognito groups.
- Faculty: dashboard, upload (PDF, DOCX, or pasted text), competency review, AI recommendations, review
  progress, accept/decline/edit each suggestion with inline diffs (accept all, reject all, undo a save), optional
  instructions for a re-run (declined suggestions are carried forward automatically), version history with diffs, submit for approval, approval
  notifications, DOCX/PDF export, star rating and comments on the Export page, My Syllabi. Approval
  decisions and their notes show on every faculty page that shows approval status.
- Admin: approval queue (pending, approved, denied), submission detail with an AI-written summary of the
  changes, the accepted suggestions, and a diff against the original,
  approve with an optional note, deny with required notes, the decision email's status, knowledge base status and manual sync, list of
  approved syllabi in the shared library, faculty feedback with the average rating.

## Mock mode

`VITE_DATA_MODE=mock` swaps in `src/api/mock.ts`, which simulates the same backend rules in the browser
(reviews take about seven seconds and return sample results). It's for UI work without AWS. A role switcher
appears in the top bar in mock mode only.

## Removed

Community contributions and moderation, the Knowledge Repository page, Settings, the reset-demo button,
per-recommendation approve/edit/reject, competency mapping confirmation, and manual draft editing. None of
these have a backend, and the team agreed to drop them for the MVP.

## Testing

- `../tests/e2e/local_api.py` runs the real backend handlers locally with AWS mocked; `../tests/e2e/browser_flow.py`
  clicks through both roles in a headless browser against it. See the backend README.
