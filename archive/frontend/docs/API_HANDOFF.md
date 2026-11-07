# PHACT API handoff

These are **PROPOSED — NOT YET IMPLEMENTED** contracts for backend review. They are not claims about existing FastAPI routes.

| Operation | Method / path | Frontend dependency | Auth |
| --- | --- | --- | --- |
| Login/session | `POST /auth/session` | Login | Institutional session; backend-owned |
| Current user | `GET /auth/me` | Protected layout | Authenticated user |
| Courses | `GET /courses` | Dashboard, Repository | Faculty-scoped |
| Dashboard | `GET /dashboard` | Dashboard | Faculty-scoped |
| Upload session | `POST /uploads` | Upload | Faculty-scoped; return upload instructions |
| Upload completion | `POST /uploads/{id}/complete` | Upload | Faculty-scoped |
| Create analysis job | `POST /analyses` | Upload | Faculty-scoped |
| Job status | `GET /jobs/{id}` | Progress, Activity | Owner or admin |
| Analysis result | `GET /analyses/{id}` | Recommendations, Mapping, Review, Export | Owner or approved viewer |
| Review mutation | `POST /analyses/{id}/review` | Review | Faculty owner |
| Activity | `GET /activity` | Activity | Faculty-scoped |
| Export | `POST /exports` | Export | Faculty owner |
| Admin queue | `GET /admin/jobs` | AdminQueue | Admin authorization |
| Admin sources | `GET /admin/sources` | AdminSources | Admin authorization |

## Response expectations

All responses should be JSON with stable identifiers, ISO-8601 timestamps, explicit status enums, and structured error bodies such as `{ "code": "...", "message": "...", "requestId": "..." }`. Upload transfer progress and analysis-processing status should be separate fields.

## Contract ownership

Analysis result fields are provisional in `src/api/types.ts` because the shared `contracts/analysis.schema.json` is not present in this frontend-only repository. When it becomes available, generate or map types explicitly rather than silently widening the provisional model.

## Two-sided syllabus approval workflow

The following contracts are also **PROPOSED — NOT YET IMPLEMENTED** and are required for the faculty/admin workflow:

| Operation | Method / path | Frontend dependency | Auth |
| --- | --- | --- | --- |
| List faculty syllabus workflows | `GET /syllabi/workflows` | Review & Approval, Dashboard | Faculty-scoped |
| Request revised syllabus generation | `POST /syllabi/{syllabusId}/versions` | Review & Approval | Faculty owner |
| Generation job status | `GET /jobs/{jobId}` | Review & Approval | Faculty owner |
| Retrieve syllabus version | `GET /syllabus-versions/{versionId}` | Faculty/admin preview | Owner or admin |
| Save draft sections | `PATCH /syllabus-versions/{versionId}` | Faculty editor | Faculty owner; draft only |
| Confirm competency mapping | `POST /syllabi/{syllabusId}/mappings/{mappingId}/confirmation` | Competency Mapping | Faculty owner |
| Submit version for review | `POST /syllabus-versions/{versionId}/submissions` | Review & Approval | Faculty owner; draft only |
| List admin submissions | `GET /admin/syllabus-submissions` | Final Syllabus Approvals | Admin authorization |
| Submission detail/history | `GET /admin/syllabus-submissions/{submissionId}` | Admin preview/comparison | Admin authorization |
| Approve submission | `POST /admin/syllabus-submissions/{submissionId}/approve` | Admin queue | Admin authorization |
| Reject submission | `POST /admin/syllabus-submissions/{submissionId}/reject` | Admin queue | Admin authorization; reason required |
| Version history | `GET /syllabi/{syllabusId}/versions` | Faculty/admin history | Owner or admin |
| Approved artifact | `GET /syllabus-versions/{versionId}/artifact` | Export | Owner or approved viewer |

Responses must preserve stable syllabus, version, submission, and decision IDs. A submitted version is immutable. Admin decisions must be idempotent and rejected when the submission is no longer pending. Rejection responses must retain the reason, reviewer identity, and timestamp. Artifact references should be backend-provided; the frontend must not construct permanent S3 URLs.
## Contract alignment note — 2026-11-04

The authoritative `PHACT_API_Contract.xlsx` workbook was inspected before this adapter update. The live adapter now treats `VITE_API_BASE_URL` as already including `/v1`, sends the raw Cognito ID token in `Authorization` (without `Bearer`), and preserves backend `{ code, message, requestId }` error fields on thrown errors. It implements the agreed upload reservation → presigned PUT → syllabus creation sequence for PDF/DOCX and pasted text. A failed live request never falls back to fixtures.

The following workbook routes are the existing contract and should not be renamed by the frontend: `POST /uploads`, `POST /syllabi`, `GET /syllabi`, `GET /syllabi/{id}`, `GET /syllabi/{id}/versions/{n}`, `POST /syllabi/{id}/competency-reviews`, `POST /syllabi/{id}/modernization-reviews`, `GET /reviews/{reviewId}`, `POST /reviews/{reviewId}/undo`, `POST /syllabi/{id}/submit`, and the `/admin/*` approval/knowledge-base routes. The current mock workflow remains local and does not claim to call these endpoints.

## Proposed extensions — PROPOSED — REQUIRES BACKEND TEAM APPROVAL

- `PUT /reviews/{reviewId}/decisions` — persist faculty recommendation decisions (`ACCEPTED`, `EDITED`, or `REJECTED`) with optional target section and edited text. The frontend adapter is prepared for this route; mock mode persists the equivalent state locally.
- `POST /syllabi/{id}/revisions` — create a revision using `baseVersion`, `reviewId`, `confirmedMappingIds`, and `expectedDecisionRevision`.
- `POST/GET /syllabi/{id}/versions/{n}/pdf` — server artifact generation/retrieval if backend-generated PDFs are required. Current PDF download is intentionally frontend-only and local.
- `GET /notifications` and `PATCH /notifications/{id}/read` — faculty approval/rejection notifications. Mock mode provides the notification bell and persistence.

The backend’s official denial terminology is `DENIED` with `denyReason`; the current mock UI uses its existing local `REJECTED` status and must be explicitly mapped to/from the backend field once the admin adapter is implemented. Approval is assumed to publish the submitted version into the approved-syllabus knowledge base (KB2) per the workbook; confirm this policy with the backend team.
