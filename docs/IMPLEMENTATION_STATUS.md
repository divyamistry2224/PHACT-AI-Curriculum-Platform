# Implementation evidence

Inspected branch: `master`, commit `834cbb7b8f01140e9aabbab8343c3dcd35d7a5c8`, November 7, 2026.

“Code present” means the implementation exists in this snapshot; it does not establish a healthy live AWS deployment. The backend suite passed 87 tests with mocked AWS services.

| Capability | Evidence under ASPPH/PHACT | Assessment |
| --- | --- | --- |
| React faculty/admin interface | frontend/src/pages, frontend/src/api/http.ts | Code present; live and mock modes |
| Cognito sign-in and refresh | frontend/src/api/cognito.ts; template.yaml | Direct Cognito API, not pasted OIDC Hosted UI sample |
| API auth and faculty ownership | backend/shared/phact/auth.py; backend/functions/faculty_read | Code present; API authorizer in SAM |
| Upload and text extraction | backend/functions/upload | Code present |
| PII handling and content checks | backend/shared/phact/pii.py, guardrails.py | Code present; no claim of perfect PII removal |
| Competency review and AI recommendations | backend/functions/competency_worker, modernization_worker | Direct Bedrock worker implementation |
| Review queues and infrastructure | template.yaml | SAM/CloudFormation implementation |
| Individual edits, versions and undo | backend/functions/decide_review, undo_review | Code present |
| Required rejection reason and decision identity/date | backend/functions/reject, approve | Code present: denyReason, decidedAt, decidedBy, decidedByEmail |
| Approval queue and faculty review UI | frontend/src/pages/AdminQueue.tsx, Review.tsx | Code present |
| Knowledge base publication/sync | backend/functions/approve, sync, kb_admin | Code present; live ingestion not tested here |
| DOCX/PDF export | frontend/src/lib/docx.ts, pdf.ts; pages/ExportShare.tsx | Browser export code present; no universal admin-before-export guarantee established |
| Decision email pipeline | backend/functions/decision_notifier | Code present; actual sending depends on SES configuration |
| Source inspection of original authoritative documents | slide 10 proposal | Proposed; citations alone do not establish full source inspection |
| CDK / FastAPI / AgentCore / Strands scaffold | user-supplied plan | Historical alternative, not this branch's implementation |
| Separate phact_rag package | attached text descriptions only | Source absent from inspected repository and uploads |
| Under-60-second analysis | presentation pilot target | Not measured; application README says live reviews may take 1–3 minutes |
| Faculty adoption/impact findings | research guide and presentation | Leadership observations; direct faculty validation pending |

## Documentation drift

The workbook's “Read me” sheet still calls phases 3 and 4 planned, while the current repository includes their handlers. It also mentions Amplify, whereas the frontend implements Cognito using fetch. Preserve the workbook as a supplied design artifact; use the current API handoff, handlers, and types to resolve mismatches.


The presentation's “a citation for every recommendation” and “approval before export/share” are pilot goals; neither is asserted as an enforced guarantee in this showcase.
