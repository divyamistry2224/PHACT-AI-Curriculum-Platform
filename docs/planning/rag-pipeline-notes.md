> Earlier design notes. Current branch code is in `ASPPH/PHACT/agents/`; its implementation differs from these notes.

# PHACT RAG pipeline


This implements the reference-preparation and RAG core for PHACT. It is designed
for the existing Python background worker architecture. It does not replace your
React app, Cognito setup, or team API. Nothing has been deployed to AWS or pushed
to GitHub by this implementation.


## Start here


1. Review `docs/SOURCE_ANALYSIS.md` and `source_manifest.json`.
2. Put this folder at `ASPPH/rag_pipeline` in the supplied repository.
3. Ask the infrastructure teammate for the actual AWS region, KB ID, model
  inference-profile ID, guardrail ID/version, source bucket/prefix, and KMS key.
  Do not send access keys in chat. Use your approved Workshop Studio AWS session.
4. Install and test locally:


```bash
cd ASPPH/rag_pipeline
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m unittest discover -s tests -v
```


System dependencies: Poppler (`pdftotext`, `pdftoppm`) and Tesseract. For an Ubuntu
development environment: `sudo apt-get install poppler-utils tesseract-ocr`.
Lambda needs those binaries packaged into its image/layer when PDF/OCR is used.
The reviewed image transcriptions are embedded in the source manifest.


Set the environment variables in `.env.example` in your shell. They are not
loaded automatically. `AWS_REGION` must match the KB/model region; Cognito may
be in a different region. Keep all AWS calls server-side.


## First AWS operation: prepare the reference collection


```bash
phact-rag prepare --manifest source_manifest.json --data-root ../Data --output build/kb-v1
```


This calls Comprehend on extracted reference pages before producing any KB-bound
text. It includes all 20 supplied reference files and excludes the five synthetic
syllabi. It preserves PDF page numbers in metadata, reads DOCX tables, handles
scanned pages, and deduplicates identical file bytes. A failed extraction or PII
service call stops preparation. A partial staging directory must be removed or a
new empty path used before retrying. Inspect the staged text for PII, OCR and
column accuracy before upload; automated detection is not a guarantee.


A report is written beside the staging directory, never inside the KB prefix.
Do not upload original unsanitized reference PDFs alongside the prepared files.
Faculty uploads remain private and are never part of the shared KB.


## Upload and ingest


The source bucket, vector index and service roles must already exist through the
team's CDK stacks. `infra/rag-knowledge-base.ts` is a TypeScript CDK construct that
connects those resources and defines the KB/data source; it is not a standalone
full-platform deployment. If your KB already exists, do not create a duplicate.


Required foundation configuration:


- KMS-encrypted, public-access-blocked reference bucket, separate from uploads.
- S3 Vectors index: float32, cosine, 1024 dimensions to match Titan V2 settings.
- Both `AMAZON_BEDROCK_TEXT` and `AMAZON_BEDROCK_METADATA` non-filterable.
- Metadata fields `status`, `source_type`, `framework` remain filterable.
- KB service role: source-prefix List/Get, necessary KMS decrypt, Titan embedding
 invocation, and scoped vector index Get/Put/Delete/Query permissions.
- Upload role: PutObject to the staging prefix plus required KMS permissions.
- Read/model role: scoped KB `bedrock:Retrieve`, Comprehend DetectPiiEntities,
 guardrail ApplyGuardrail and model invocation. Inference-profile permissions
 must include the profile and permitted destination model resources.


Preview the upload first, then execute with your real values:


```bash
phact-rag upload --directory build/kb-v1 --bucket YOUR_SOURCE_BUCKET --prefix approved/v1 --kms-key-arn YOUR_KMS_KEY_ARN
phact-rag upload --directory build/kb-v1 --bucket YOUR_SOURCE_BUCKET --prefix approved/v1 --kms-key-arn YOUR_KMS_KEY_ARN --execute
phact-rag sync --data-source-id YOUR_DATA_SOURCE_ID
```


The KB data source inclusion prefix must match `approved/v1/`. Wait for ingestion
status COMPLETE before querying. Use the team's CDK deployment to change corpus
prefixes; old sources must not remain eligible. Retirement is not instantaneous:
metadata changes/deletions require ingestion sync and retrieval verification.
For immediate revocation, enforce the source-inventory allowlist at retrieval as
an additional team integration before release.


Page files are configured as `NONE` chunking in the CDK construct: each is one
source page with its own original `page` metadata. This preserves the supplied
competency tables better than arbitrary small token splits. Inspect retrieval
quality and adjust if pages are too broad. Do not remove a live vector index
without the clean data-source reset procedure in the project technical document.


## Test retrieval, then analyze one synthetic syllabus


```bash
phact-rag retrieve --query "How should faculty teach AI literacy, bias evaluation and responsible AI use?"
phact-rag analyze --syllabus ../Data/Approved\ Syllabi/Synthetic/MPH_Syllabus_01_Northeast_Epidemiology.docx --output build/epidemiology-draft.json
```


Retrieval diagnostics print source IDs/page numbers only. Analysis saves a private
JSON draft containing specific recommendations, suggested CEPH mappings, source
titles, original-page metadata, and source snippets. Successful parsing and valid
citation IDs are necessary checks, not proof that each claim is supported. A
human must inspect semantic support before approval.


Core flow:


1. Extract syllabus and reject inputs above the MVP 90 KB UTF-8 text limit.
2. Comprehend PII redaction and input-only Bedrock Guardrail.
3. Retrieve approved AI guidance, CEPH competencies, course examples and wider
  workforce context in four searches. At present searches run sequentially.
4. Re-scrub retrieved passages, then generate through Bedrock Converse using the
  configured model inference profile. No output guardrail is attached.
5. Validate strict JSON, citation IDs, ASPPH support for each recommendation and
  CEPH framework support for each MPH mapping. Scrub generated text too.
6. Return Draft with evidence; no approval/export action is implemented here.


This deterministic Retrieve + Converse core can be called as a tool/function from
the team's Strands agent. AgentCore hosting is not included in this package.
Avoid adding a second generation step that discards these citation checks.


## Connect to the application


`phact_rag.worker.handler` is an async Lambda adapter. It accepts only `job_id`,
claims a QUEUED job conditionally to reduce duplicate execution, reads the
ownership-bound private upload, runs the core, stores the draft in KMS-encrypted
S3, and records SUCCEEDED or FAILED. It does not create its own public API.


Additional worker environment variables:


- `JOBS_TABLE` with string partition key `job_id`.
- `UPLOADS_BUCKET`, `OUTPUTS_BUCKET`, `OUTPUTS_KMS_KEY_ARN`.
- Job record fields: `job_id`, `owner_sub`, `input_key`, `status=QUEUED`.
- Input key format: `uploads/{owner_sub}/...pdf`, `.docx` or `.txt`.
- Handler: `phact_rag.worker.handler`. Configure enough memory and background
 timeout; the ~60-second product target has not been measured.


The authorized API must derive owner_sub from validated Cognito claims, create
the job and async-invoke the worker. GET job/result must enforce ownership. Render
AI text as escaped text/sanitized Markdown, never unsanitized HTML. Keep source
locations server-side unless explicitly approved for display.


The API/review layer still needs: status polling, conditional versioned approval,
export/share enforcement, source moderation, and timeout recovery for RUNNING
jobs if Lambda is terminated. Store only generic error codes in user-facing job
records. Disable payload logging and inspect CloudWatch/Bedrock logs. Encrypting
logs does not make raw PII acceptable. Do not use the synchronous CLI inside an
API Gateway request.


## Verification and limitations


- 20 reference files / 196 pages extracted with no empty pages after OCR and
 reviewed image transcription; all five synthetic syllabi extracted with tables.
- Unit tests use fake AWS clients. They test failure behavior and citation gates;
 they do not measure live model accuracy or end-to-end latency.
- CDK TypeScript is typechecked and its construct synthesized locally; foundation
 resources are imported. Deployment and IAM verification remain in AWS.
- No AWS IDs/credentials were provided for live ingestion or inference, so no
 claim of a working cloud deployment is made.


See `docs/evaluation_cases.json` for the first live quality checks. Do not report
simulated test outputs as real faculty results.


