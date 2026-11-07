# PHACT frontend implementation status

## Working frontend-only

- React/Vite app and preserved visual system.
- HashRouter route registry and deep links.
- Grouped role-aware navigation.
- Login/logout UI with explicit mock session.
- Local DOCX export and print/PDF behavior.
- Responsive layout and existing interaction states.

## Working in mock mode

- Dashboard, course history, activity, repository, and admin data.
- Syllabus upload and pasted text flow.
- Simulated analysis job transitions and retry behavior.
- Recommendation editing, approval, rejection, and history.
- Competency mapping and community contribution workflow.
- Settings and local browser persistence.
- Revised syllabus generation from accepted recommendations and confirmed mappings.
- Structured syllabus preview/editor, submission confirmation, and original/revised comparison.
- Shared mock-state faculty/admin submission workflow with persistent version history.
- Administrator final syllabus approval/rejection with required rejection reason.
- Faculty feedback, revision creation, resubmission, and approval tracking.

## Ready for backend integration

- Central `PhactApi` service boundary.
- `VITE_DATA_MODE` and `VITE_API_BASE_URL` configuration.
- Explicit HTTP adapter that never silently falls back to mock data.
- Proposed API handoff contracts.
- Route and role integration points.
- Typed syllabus-version, submission, and administrative-decision integration points.

## Requires backend implementation

- Institutional authentication and session refresh.
- Durable course and analysis persistence.
- Presigned upload sessions and server-side file verification.
- Real analysis job orchestration and status updates.
- Contract validation against the shared analysis schema.
- Authorization for faculty/admin operations.
- Durable review/version history and server-generated exports.
- Backend-authoritative syllabus generation, artifact storage, and final approval persistence.

## Not implemented here

- FastAPI server, AWS resources, agents, shared contracts, or deployments. Those remain outside the frontend scope.
- Automated browser E2E suite; the two-role workflow was manually smoke-tested in the local preview.
