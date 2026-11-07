# PHACT API integration

The front end calls the PHACT backend through one adapter, `src/api/http.ts`. Every operation below is
implemented by the backend and wired in the adapter. Field names in `src/types.ts` match the backend exactly
(the source of truth is `PHACT_API_Contract.xlsx` and the backend README in `../README.md`).

## Configuration

`deploy.sh` builds the hosted app with these set from the stack outputs. For local work, copy `.env.example`
to `.env.local`.

| Variable | Value |
| --- | --- |
| `VITE_DATA_MODE` | `live` (call the API) or `mock` (simulate it in the browser) |
| `VITE_API_BASE_URL` | Stack output `ApiUrl`, which already ends in `/v1` |
| `VITE_AWS_REGION` | Stack output `Region` |
| `VITE_USER_POOL_ID` | Stack output `UserPoolId` |
| `VITE_USER_POOL_CLIENT_ID` | Stack output `UserPoolClientId` |

## Sign-in

`src/api/cognito.ts` signs in with Cognito's `USER_PASSWORD_AUTH` flow using plain `fetch` (no Amplify),
keeps the session in localStorage (`phact-session`), and refreshes the ID token a minute before it expires.
The raw ID token goes in the `Authorization` header with no `Bearer` prefix. Name, email, and role come from
the token's `name`, `email`, and `cognito:groups` claims (`admin` group means admin, otherwise faculty).

## Operations

| Adapter method | Endpoint | Used by |
| --- | --- | --- |
| `uploadSyllabus` | `POST /uploads`, `PUT` to the presigned URL, `POST /syllabi` | Upload |
| `listSyllabi` | `GET /syllabi` | Dashboard, My Syllabi, course selector, notifications |
| `getSyllabus` | `GET /syllabi/{id}` | Every faculty workflow page |
| `getVersion` | `GET /syllabi/{id}/versions/{n}` | Review & Submit, Export |
| `startReview` | `POST /syllabi/{id}/competency-reviews` or `/modernization-reviews`, with optional `{guidance}` | Upload, Competency Review, AI Recommendations ("Add instructions" beside Run again) |
| `getReview` | `GET /reviews/{id}` (polled every 3 s while running) | Progress, Competency Review, AI Recommendations |
| `decideReview` | `POST /reviews/{id}/decisions` (accept, decline, or edit each change, then save) | Competency Review, AI Recommendations |
| `undoReview` | `POST /reviews/{id}/undo` ("Undo this save") | Competency Review, AI Recommendations |
| `submitSyllabus` | `POST /syllabi/{id}/submit` | Review & Submit |
| `submitFeedback` | `POST /feedback` | Export (star rating and comment) |
| `listQueue` | `GET /admin/queue?status=PENDING\|APPROVED\|DENIED` | Final Syllabus Approvals, Knowledge Management |
| `getSubmission` | `GET /admin/syllabi/{id}` | Final Syllabus Approvals |
| `approveSubmission` | `POST /admin/syllabi/{id}/approve` with optional `{note}` | Final Syllabus Approvals |
| `rejectSubmission` | `POST /admin/syllabi/{id}/reject` with required `{reason}` | Final Syllabus Approvals |
| `summarizeSubmission` | `POST /admin/syllabi/{id}/summary` | Final Syllabus Approvals (summary of changes) |
| `listKnowledgeBases` | `GET /admin/kb` | Knowledge Management |
| `syncKnowledgeBase` | `POST /admin/kb/sync` | Knowledge Management |
| `listFeedback` | `GET /admin/feedback` | Faculty Feedback |

Errors arrive as `ApiError` with the backend's `code`, a `message` that's safe to show, and `requestId`.
A 401 clears the session and returns to the sign-in page.

## How the faculty workflow maps to the backend

- A review returns suggestions (`changes` or `recommendations`), each with `hunkIds` pointing at blocks of
  changed lines in `results.hunks`; `otherHunkIds` are edits no suggestion claimed. The faculty member
  accepts, declines, or edits each suggestion (`components/suggestions.tsx`); saving sends one decision per
  hunk and the backend composes the next version. Declining everything creates no version.
- While `syllabus.pendingReviewId` is set, the run-review buttons are disabled; the backend also refuses
  with `DECISION_PENDING`.
- Approval notifications are derived from `GET /syllabi` (`approvalStatus`, `decidedAt`, `denyReason`,
  `approvalNote`); "read" is remembered in the browser.
- The admin's denial notes are `denyReason` (required); approval comments are `approvalNote` (optional).
- "Add instructions" beside Run again sends `guidance` with the next run. The review comes back with
  `guidance` and `declinedContext` (titles of suggestions declined in earlier runs, which the model is told
  not to repeat); `RunContext` in `components/workspace.tsx` shows both above the results.
- After an approve or deny, `GET /admin/syllabi/{id}` returns `syllabus.notification` once the
  stream-triggered email function has run (a few seconds). The admin page polls briefly and shows "Email
  sent to ..." or "Email to ... not sent: {detail}". The demo has no SES sender, so it shows not sent.
- Export builds DOCX and PDF files in the browser from the stored version text. PDFs use jsPDF (loaded only
  when exporting) with real tables, a running header, and page numbers.
- Syllabus text arrives with personal details already purged (labels like `[name removed]`); the front end
  never sees or restores them.
