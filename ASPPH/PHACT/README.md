# PHACT backend

Faculty upload a syllabus, get it graded against the 22 CEPH foundational competencies and reviewed for AI and modern-technology integration, iterate on a versioned working copy, and submit it for admin approval into a shared knowledge base.

Everything deploys from one AWS SAM template (`template.yaml`, which is CloudFormation) plus `scripts/deploy.sh`.

## Prerequisites

- AWS CLI v2, signed in to the sandbox account (`aws sts get-caller-identity` works)
- AWS SAM CLI (`brew install aws-sam-cli`)
- Python 3.12
- Node 22 and pnpm (`brew install node@22 pnpm`) to build the front end. Without them the backend still deploys and the front end step is skipped with a message

## AgentCore reviews

The review workers support both direct Bedrock calls and the three-agent AgentCore runtime. Set `PHACT_AGENTCORE_RUNTIME_ARN` when deploying to select an existing runtime. That runtime must include the native SAM review contract from `agents/`. With no runtime ARN configured, the current direct-Bedrock workflow remains active.

See [AgentCore setup](../../docs/AGENTCORE.md) for runtime requirements and deployment order.

## Deploy

```bash
export AWS_PROFILE=<sandbox profile>              # if not your default
export PHACT_MODEL_ID=<Claude inference profile>  # e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0
export PHACT_FACULTY_PASSWORD='<12+ chars, upper, lower, number>'
export PHACT_ADMIN_PASSWORD='<12+ chars, upper, lower, number>'
./scripts/deploy.sh
```

The script builds, deploys the `phact` stack to `us-east-1`, saves the stack outputs to `.phact/outputs.json`, creates the demo users (`faculty@phact.demo`, `admin@phact.demo`), checks `/health`, then builds the front end and publishes it. It ends by printing the web app's URL. Re-running it is safe.

The first deploy that adds the CloudFront distribution takes an extra 5 to 10 minutes while CloudFront rolls out.

Optional: `export PHACT_NOTIFICATION_SENDER=<address verified in SES>` turns on real decision emails (see "Decision emails" below). Without it, the emails are built and recorded as not sent.

## Front end hosting

`frontend/` is the team's React app. `deploy.sh` builds it with the stack's values baked in (`VITE_API_BASE_URL`, `VITE_AWS_REGION`, `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`) and uploads it to a private S3 bucket behind CloudFront, which gives it a random `https://<id>.cloudfront.net` address. No domain, certificate, or Route 53 is needed. The app uses hash routes (`/#/dashboard`), so every page loads from `index.html` without rewrite rules.

- `PHACT_DATA_MODE=live` (default) makes the app call the API, with Cognito sign-in. `PHACT_DATA_MODE=mock` builds it with simulated data in the browser instead, as a fallback.
- `PHACT_SKIP_FRONTEND=1` deploys the backend only.
- Hashed JS and CSS bundles are cached for a year, `index.html` is always revalidated, and each deploy invalidates CloudFront, so changes show up within a minute of the deploy finishing.

To run the front end locally against the deployed API, copy the values from `.phact/outputs.json` into `frontend/.env.local` (the variable names are in `frontend/.env.example`) and run `pnpm dev`. The front end's own docs are in `frontend/docs/`.

## Test the web app locally (no AWS needed)

`tests/e2e/local_api.py` runs the real Lambda handlers behind a local HTTP server, with AWS replaced by moto and the same fake Bedrock the unit tests use, plus a stand-in Cognito sign-in. Reviews take about ten seconds and return canned results.

```bash
pip install "moto[server]" boto3 pypdf playwright
python3 tests/e2e/local_api.py &                      # API on http://localhost:8787/v1
cd frontend
VITE_DATA_MODE=live VITE_API_BASE_URL=http://localhost:8787/v1 VITE_USER_POOL_CLIENT_ID=local \
  VITE_COGNITO_ENDPOINT=http://localhost:8787/cognito/ pnpm build
cd dist && python3 -m http.server 4173 &              # or use pnpm dev with the same variables
cd ../.. && python3 tests/e2e/browser_flow.py         # clicks through both roles in a headless browser
```

Sign in as `faculty@phact.demo` or `admin@phact.demo` with the password `Demo-Password-1` (local harness only). `browser_flow.py` covers sign-in, upload, both reviews, keep and discard, submit, deny with notes, the faculty notification, resubmit, the decision email status, approve with a note, a re-run with instructions, the knowledge page, export, feedback, and phone width. The harness plays the DynamoDB Stream's part, handing each decision to the real notifier function.

## Check a deploy

```bash
python3 scripts/smoke_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx
```

It signs in as the faculty user, uploads the file through a presigned URL, creates a syllabus, and reads it back.

```bash
python3 scripts/kb_check.py --wait
```

It waits for running ingestion jobs, reports each knowledge base's latest job, and runs a real retrieval against KB1 that must return all 22 CEPH competencies.

```bash
python3 scripts/review_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx
```

It runs real reviews end to end: checks that off-topic text is rejected at upload, uploads the syllabus, runs a competency review (v2) and an AI modernization review on top of it (v3), then undoes the second. It prints each stage with timings and a summary of the results. Expect each review to take one to three minutes.

```bash
python3 scripts/approval_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx
python3 scripts/seed_kb2.py
python3 scripts/kb_check.py
```

`approval_test.py` checks the approval flow (admin-only access, submit, the queue, reject with a reason, resubmit, KB status) and rejects its own submission at the end, so it never adds anything to KB2. `seed_kb2.py` runs once per new stack: it uploads seed syllabi 02 to 05 as the faculty user, submits them, approves them as the admin user, and waits for KB2 ingestion. After that, `kb_check.py` lists the approved syllabi KB2 can retrieve, and modernization reviews cite peer examples. Seed 01 stays out of KB2 because the review tests use it, and a review would otherwise find its own twin as a peer (`--all` includes it anyway). Both scripts need `PHACT_FACULTY_PASSWORD` and `PHACT_ADMIN_PASSWORD`.

## How PHACT protects personal data and stays on task

1. **Upload:** the guardrail checks the extracted text, and off-topic content (creative writing, personal finance, entertainment, individual medical advice) is rejected with a friendly message. Then Amazon Comprehend **purges personal details permanently**, before anything is stored:
   - **Removed:** people's names, emails, phone numbers, personal links, usernames, and ID or account numbers. Each becomes a label such as `[name removed]` or `[email removed]`.
   - **Kept:** course and institution names, university and building addresses, dates, and authors on reading-list or reference lines (a year, edition, "et al.", or DOI). Instructor and TA names are always removed, even on those lines. Set `PII_KEEP_CITED_AUTHORS=false` on the Upload function to remove cited authors too.
   - **The original file is deleted** right after its text is extracted, so no copy with personal details survives. The course description is purged the same way.
2. **Reviews:** the guardrail checks the purged text again before the model sees it. Sonnet, the embedding model behind the peer search, and every version a review creates only ever see purged text. Nothing is restored afterward.
3. **Model output:** the guardrail checks everything the model writes, blocks harmful content, and masks any contact details the model invents.
4. **Approval:** the copy that goes into the shared library (KB2) is purged a second time, as a second line of defense.
5. **Feedback comments** are purged the same way before they're stored.
6. **Grounding:** CEPH statements and interpretations attached to results come from KB1, not from the model. Peer-example excerpts come from KB2 retrieval, and any citation the model makes to an example it wasn't given is dropped.

The guardrail runs through the standalone `ApplyGuardrail` API in chunks rather than attached to the model call, so long syllabi stay within per-request limits and masking edits the text instead of replacing the whole answer. Content filters are set to LOW strength because public health syllabi legitimately cover violence, sexual health, and substance use.

## How reviews become versions

A review doesn't change the syllabus by itself. It produces **suggestions**: each CEPH change or AI recommendation, with its own changes to the text shown as an inline diff.

1. The worker diffs the input version against the model's revision and splits the diff into blocks of changed lines. Neighboring added paragraphs become separate blocks, so two suggestions that add text side by side can each be decided on their own.
2. Each block is attached to the suggestion whose verbatim quotes (the model returns them with each suggestion) appear in it. Blocks no suggestion claims are shown as "Other edits", so nothing is applied silently.
3. The faculty member accepts, declines, or edits each suggestion, or uses accept all or reject all. Saving composes the accepted blocks, with any edits, into the next version. Edits pass the guardrail and the PII purge first. Declining everything creates no version.
4. Until they decide, no other review can start on that syllabus. Undo removes the latest saved version.

**Instructions for a run.** When a faculty member runs a review again, they can add instructions (up to 1,000 characters), such as "prefer AI-resistant assessments" or "leave weeks 1 to 3 alone". The text passes the guardrail and the PII purge, is stored on the review as `guidance`, and goes into the user message inside `<faculty_guidance>` tags, never the system prompt. The system prompt tells the model to use it for which changes to suggest and how to word them, and that it can't override the rules: it never changes competency grades (those reflect the syllabus as written) and can't add a peer example that wasn't retrieved. Every run also lists the titles of suggestions the faculty member declined in earlier reviews of the same type (up to 12, stored as `declinedContext`) inside `<declined_before>` tags, so declined ideas don't come back. The results page shows both, and the admin's summary of changes mentions the instructions.

## How approval works

1. **Submit:** the faculty member submits their current working copy. The admin sees an AI-written summary of what changed, generated from the faculty member's recorded decisions (never the syllabus text), with the exact list of accepted suggestions under it. It joins the admin queue as PENDING. They can keep running reviews (which create newer versions), but they can't undo the submitted version while it waits. One submission per syllabus is pending at a time.
2. **Reject:** the admin must give a reason, which the faculty member sees as `denyReason`. They can then revise and submit again.
3. **Approve:** Amazon Comprehend purges the submitted version a second time (it was already purged at upload), and the result is written to `approved/{syllabusId}.md` in the KB source bucket with a metadata file (syllabusId, title, subject, institution, version, approvedAt). The S3 event starts KB2 ingestion within about a minute. Approving a newer version of the same syllabus replaces the older one, so KB2 holds one document per syllabus.
4. **Safety:** each decision is a conditional write, so two admins can't decide the same submission differently. If the KB write fails, the approval is rolled back to PENDING. An approved version can't be undone.

## Decision emails

Approving or denying a submission emails the faculty member, without the approve and reject functions knowing about email:

1. The Syllabi table has a DynamoDB Stream (new and old images).
2. `DecisionNotifierFunction` subscribes with a filter, so Lambda only runs for a change from `PENDING` to `APPROVED` or `DENIED`. Every other write to the table is ignored without an invocation.
3. It builds the email (subject "Approved: {title}" or "Revisions requested: {title}", the admin's note or reasons, and a link to the web app) and sends it with Amazon SES from `NotificationSenderEmail`.
4. It records the outcome on the syllabus as `notification` (`status` `SENT` or `NOT_SENT`, `to`, `decision`, `version`, `at`, and `detail` or `messageId`), and the admin's approval page shows it under the decision. Failures SES won't fix by retrying (no sender, unverified address, sandbox) are recorded as `NOT_SENT`; other errors retry up to three times.

**For the demo** the faculty addresses (`faculty@phact.demo`) aren't real mailboxes, so no sender is configured and each email shows as "not sent: No verified SES sender address is configured". The pipeline still runs end to end, so the stream, filter, function, and recorded result are all real. To send real email later:

- Set `PHACT_NOTIFICATION_SENDER` to an address or domain you can verify, and redeploy. The stack creates the SES identity; click the link in the verification email SES sends.
- While the account is in the SES sandbox, recipients must be verified too. Request production access in the SES console to email any faculty address.

## Data retention

A professor's syllabus and everything in it lives **180 days from its original upload** (`RetentionDays` in the template), then deletes itself:

- **S3:** all working files sit under `faculty/{cognito-sub}/` in the app bucket (originals, every version, review results). A lifecycle rule expires the whole bucket's objects after 180 days.
- **Feedback** (ratings and comments) is kept without expiry in its own table; it holds no syllabus text.
- **DynamoDB:** syllabus and review records carry `expiresAt`, and both tables have TTL enabled on it. TTL can run a day or two late, so the API also hides anything past `expiresAt` and returns `410 EXPIRED` for it.
- **Never expires:** approved syllabi, which are copied into the separate KB source bucket (`approved/`), and the CEPH files (`ceph/`).

## CEPH competency files

`data/ceph/` holds 22 Markdown files (one per competency) and their `.metadata.json` files. They were produced once by `scripts/split_ceph.py` from the PDF in `data/ceph-source/` and **must be proofread by a person**: they're the ground truth for every grade. `deploy.sh` uploads only changed files, which triggers KB1 ingestion. To regenerate after a CEPH update: `pip install pdfplumber && python3 scripts/split_ceph.py`, then proofread and commit.

## Run the unit tests

```bash
pip install "boto3>=1.39" "moto[dynamodb,s3]>=5" pytest pypdf
python3 -m pytest tests -q
```

## Layout

```
frontend/            The team's React app (owned by the front end team; deploy.sh builds and uploads it)
template.yaml        All infrastructure (SAM / CloudFormation), including front end hosting
samconfig.toml       SAM defaults (stack name, region)
backend/shared/      Lambda layer: DynamoDB access, S3 helpers, auth, HTTP responses
backend/functions/   One folder per Lambda function
data/ceph/           22 CEPH competency files + metadata (uploaded to KB1)
data/seed-syllabi/   Synthetic syllabi for testing and seeding KB2
data/ceph-source/    The original CEPH PDF (never uploaded to a knowledge base)
scripts/             deploy.sh, smoke_test.py, kb_check.py, review_test.py, approval_test.py,
                     seed_kb2.py, split_ceph.py
tests/               Unit tests with mocked AWS; tests/e2e/ has the local harness and browser walkthrough
```

## Build status

| Phase | Contents | Status |
| --- | --- | --- |
| 1 | Cognito, DynamoDB tables, app bucket, REST API, Health, Upload, FacultyRead | Built |
| 2 | S3 Vectors, KB1 (CEPH) and KB2 (approved syllabi), sync queue and Sync function, CEPH files | Built |
| 3 | Review queues and workers, GetReview, UndoReview, guardrail, PII handling, prompts | Built |
| 4 | Submit, admin queue, Approve, Reject, KB admin, KB2 seed script | Built |
| 5 | S3 + CloudFront hosting, front end build in `deploy.sh`, front end wired to the live API with Cognito sign-in | Built |
| 5+ | Per-suggestion decisions, AI submission summary, feedback, run instructions, decision emails (DynamoDB Stream, DecisionNotifier, SES) | Built |

## API

All endpoints except `/health` need a Cognito ID token in the `Authorization` header. `/admin/*` endpoints return 403 unless the user is in the `admin` group.

| Method and path | What it does |
| --- | --- |
| `GET /health` | No sign-in. Confirms the deploy is reachable |
| `POST /uploads` | Body `{fileName, fileSize?}`. Returns a presigned `PUT` URL and `uploadKey` |
| `POST /syllabi` | Body `{title, subject?, institution?, description?, uploadKey or text}`. Extracts text, checks it with the guardrail, creates version 1 |
| `GET /syllabi` | The caller's syllabi, newest first |
| `GET /syllabi/{id}` | One syllabus with its versions and reviews |
| `GET /syllabi/{id}/versions/{n}` | The text of one version |
| `POST /syllabi/{id}/competency-reviews` | Body `{guidance?}` (optional instructions for this run, up to 1,000 characters). 202 with the queued review, including `guidance` and `declinedContext`. 409 `REVIEW_RUNNING` if one is running, `DECISION_PENDING` if a review's suggestions are waiting for decisions; 400 `GUIDANCE_BLOCKED` if the guardrail blocks the instructions |
| `POST /syllabi/{id}/modernization-reviews` | Same, for the AI modernization review |
| `GET /reviews/{id}` | Poll every 3 s. Status and stage; when `COMPLETED`, also `results` (grading or recommendations, plus `diff`) |
| `POST /reviews/{id}/decisions` | Body `{decisions: [{hunkId, accept, text?}]}`. Saves accepted (and edited) changes as the next version; declining all creates none. 409 `NOT_PENDING` or `STALE`; 400 `CONTENT_BLOCKED` for an edit the guardrail blocks |
| `POST /reviews/{id}/undo` | Removes the version a saved review created. 409 `NOT_LATEST`, `NOT_UNDOABLE`, `SUBMITTED`, or `APPROVED` |
| `POST /syllabi/{id}/submit` | Submits the current version for approval. 409 `ALREADY_SUBMITTED`, `ALREADY_APPROVED`, or `REVIEW_RUNNING` |
| `GET /admin/queue?status=` | Admin only. `PENDING` (default, oldest first), `APPROVED`, or `DENIED` (newest first) |
| `GET /admin/syllabi/{id}` | Admin only. The submitted version's text, its diff against v1, and the reviews behind it. `syllabus.notification` is the decision email's status once the notifier has run (`null` before then) |
| `POST /admin/syllabi/{id}/approve` | Admin only. Body `{note?}` (shown to faculty as `approvalNote`). Scrubs PII and copies the submitted version into KB2. 409 `NOT_PENDING` |
| `POST /admin/syllabi/{id}/reject` | Admin only. Body `{reason}` (required). 409 `NOT_PENDING` |
| `POST /admin/syllabi/{id}/summary` | Admin only. AI-written summary of the submission's changes, generated once per submitted version and cached |
| `GET /admin/kb` | Admin only. Each knowledge base's document count and latest sync |
| `POST /feedback` | Body `{syllabusId, version?, rating (1-5), comment?}`. Comment is purged of personal details |
| `GET /admin/feedback` | Admin only. All feedback, newest first, with the average rating |
| `POST /admin/kb/sync` | Admin only. Body `{kb: CEPH or APPROVED_SYLLABI}`. 409 `SYNC_RUNNING` |

Errors return `{code, message, requestId}`; `message` is safe to show users.
