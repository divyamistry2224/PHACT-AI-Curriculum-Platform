# Technical Environment Document: PHACT — Public Health AI Curriculum Transformation Platform

## Project Technical Summary

- **Project Name**: PHACT — Public Health AI Curriculum Transformation Platform (MVP)
- **Primary Runtime Environment**: Cloud
- **Cloud Provider**: AWS
- **Target Deployment Model**: Serverless-first, fully defined as infrastructure-as-code. A React SPA on Amplify Hosting calls a Python FastAPI backend on Lambda behind API Gateway (Cognito-authorized); long-running AI work runs asynchronously on Strands agents hosted on Bedrock AgentCore, grounded by a Bedrock Knowledge Base over S3 Vectors. The entire stack is redeployable into ASPPH's own AWS account after the event.
- **Customer Team Experience**: Standalone hackathon build in an AWS-provided Workshop Studio account (account `963505482519`, region `us-east-1`). Uses only public or synthetic content — no proprietary member data and no ARIE production data. No MyASPPH single sign-on; demo users are pre-provisioned in Cognito.

---

## Programming Languages

### Required Languages

| Language | Version | Purpose | Rationale |
|----------|---------|---------|-----------|
| Python | 3.12 | FastAPI backend on Lambda, worker Lambda, Strands agents, text extraction, PII/guardrail services | Strong AWS SDK, Bedrock/Strands, and document-processing ecosystem; the backend and agents share one language |
| TypeScript / JavaScript | Current (React) | Student/faculty-facing SPA on Amplify Hosting | Existing front-end convention; integrates with Amplify Auth |
| TypeScript (CDK) | Current | Infrastructure-as-code for all stacks | IaC requirement so the build redeploys into ASPPH's account |

### Permitted Languages

| Language | Conditions for Use |
|----------|-------------------|
| SQL / PartiQL | Only as needed for DynamoDB access patterns; no relational database is in the MVP |
| Shell | Deployment, agent launch (`agentcore`), and one-off operational scripts |

### Prohibited Languages

| Language | Reason |
|----------|--------|
| Any new server runtime outside the Python/TypeScript stack | The MVP deliberately keeps a single backend language and a single IaC language to bound operational surface during the hackathon |

---

## Frameworks and Libraries

### Required Frameworks

| Framework/Library | Version | Domain | Rationale |
|-------------------|---------|--------|-----------|
| FastAPI + Mangum | Current | HTTP backend on Lambda behind API Gateway | Python API framework adapted to Lambda via Mangum; Cognito authorizer guards `/api/*` |
| React | Current | Faculty/admin SPA | Front-end UI, hash-routed, hosted on Amplify |
| AWS Amplify (Auth + Hosting) | Current | Auth library → Cognito, SPA hosting/CI/CD | Single-URL hosting and Cognito-backed sign-in without hand-rolled auth |
| Strands SDK | Current | AI agent authoring (curriculum, competency) | Builds the agents deployed to AgentCore; integrates Bedrock models and KB retrieval tools |
| AWS CDK | Current (TypeScript) | Infrastructure-as-code | Required for redeployable IaC; defines Foundation, Auth, Data, Api, Observability stacks |
| boto3 | >= 1.39 | AWS SDK for Python (Bedrock, AgentCore, S3, DynamoDB, Comprehend, KMS) | Native AWS integration; must be recent enough to know the `bedrock-agentcore` client |

### Preferred Libraries

| Library | Purpose | Use When |
|---------|---------|----------|
| pypdf / python-docx | Syllabus text extraction and DOCX export | Extracting pasted/uploaded syllabus text; generating approved-output DOCX |
| Amazon Comprehend (`DetectPiiEntities`) | Primary PII pre-scrub | Always, on any text before it reaches an agent or Bedrock model |
| Bedrock Knowledge Bases `RetrieveAndGenerate` / `Retrieve` | Grounded answers with citations | Any recommendation or competency mapping that must cite ASPPH sources |

### Prohibited Libraries

| Library | Reason | Alternative |
|---------|--------|-------------|
| Any synchronous in-request call to a long-running agent | Agent runs take 25s–few minutes and exceed API Gateway's 29s timeout | Async pattern: API writes a QUEUED job and async-invokes a worker Lambda; UI polls `GET /api/jobs/{id}` |
| Bedrock Guardrail attached to agent output (Strands `BedrockModel`) | The guardrail's PII layer false-positives and any output intervention makes Strands replace the whole response with the block message | Apply the guardrail at API **input** only, plus Comprehend PII pre-scrub; agents use a plain `BedrockModel` |

---

## Cloud Environment

### Cloud Provider
- **Primary Provider**: AWS
- **Account Structure**: AWS-provided Workshop Studio account `963505482519` for the hackathon; IaC enables redeploy into ASPPH's own account post-event.
- **Regions**: `us-east-1`. Bedrock model access, S3 Vectors, AgentCore, and Bedrock Knowledge Bases confirmed available before the event.

### Core Services

| Service | Role in PHACT |
|---------|---------------|
| Amazon Cognito | User pool with `faculty` and `aspph-admin` groups; API Gateway Cognito authorizer; Amplify Auth on the SPA |
| API Gateway + Lambda | FastAPI backend (`/health` public, `/api/*` authorized); worker Lambda for async agent jobs |
| Amazon Bedrock | Foundation models (Claude via inference profiles), Knowledge Bases, Guardrails |
| Bedrock AgentCore | Hosts the Strands curriculum and competency agents as runtimes |
| S3 + S3 Vectors | KMS-encrypted buckets (knowledge, per-user uploads, community, exports) + vector store for the KB |
| Amazon Comprehend | PII detection for the pre-scrub layer |
| DynamoDB | Jobs, outputs, and source inventory tables |
| KMS | Encryption for S3, logs, and model-invocation logging |
| CloudWatch + CloudTrail | Lambda logs, encrypted Bedrock model-invocation logs, audit trail |
| Amplify Hosting | Single-URL React SPA hosting with CI/CD |

### Service Disallow List

| Service | Reason | Alternative |
|---------|--------|-------------|
| Amazon SageMaker (for the sandbox) | The AI sandbox is out of MVP scope; if built later, containerized Jupyter on EKS/Fargate or the Bedrock playground is preferred | Bedrock playground / containerized Jupyter (Phase 2) |
| MyASPPH SSO integration | Hackathon build is standalone | Pre-provisioned Cognito demo users |
| Proprietary member data / ARIE production data | Only public or synthetic content is permitted in the Workshop Studio account | Synthetic/public source documents |

---

## Preferred Technologies and Patterns

### Architecture Patterns

| Pattern | When to Use | When Not to Use |
|---------|-------------|-----------------|
| Async job + polling for AI work | All agent-backed analysis (curriculum, competency); API writes QUEUED, async-invokes the worker Lambda, UI polls | Never run an agent synchronously inside the API request path (29s timeout) |
| Grounded generation with citations | Every recommendation and competency mapping, via Bedrock KB `RetrieveAndGenerate` | Never present AI synthesis as grounded without a visible source citation |
| Two-layer responsible AI | Comprehend PII pre-scrub on input + Bedrock Guardrail (content filters, denied topics) at API input | Never attach the guardrail to agent output; never rely on the guardrail's PII layer alone |
| Human-in-the-loop review gate | All outputs stay Draft until a human approves; only approved items export/share | Never export or share un-approved output |
| Least-privilege, encrypted-by-default storage | All S3 buckets KMS-encrypted + public-access-blocked; per-user upload prefixes kept private | Never co-mingle private uploads with the shared knowledge-base bucket |
| Infrastructure-as-code (CDK) | All resources, so the stack redeploys into ASPPH's account | Never create demo resources by hand outside the CDK stacks |

### Implementation Notes and Known Gotchas

- **Bedrock inference profiles required.** Newer Claude models (Sonnet 4.5+) reject bare on-demand model IDs with `ValidationException`. Use a cross-region inference-profile ID (e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`), ideally via the Converse API, for both agents and direct calls.
- **S3 Vectors index metadata.** When creating the index, mark both `AMAZON_BEDROCK_TEXT` and `AMAZON_BEDROCK_METADATA` as non-filterable, or ingestion fails on the 2048-byte filterable-metadata cap (and silently drops docs if the second key is missed).
- **Never delete the S3 Vectors index under a live Bedrock data source.** Bedrock's ingestion tracking will report "0 new" and skip re-indexing. Clean reset: delete data source → delete+recreate index → recreate data source → start ingestion; then verify retrieval coverage across all docs, not just ingestion stats.
- **AgentCore CLI and launch.** Two `agentcore` CLIs coexist; the pip `bedrock-agentcore-starter-toolkit` (Direct Code Deploy, no Docker) is the fast path. Pass env vars (`KB_ID`, `MODEL_ID`) at **launch**, not configure, or KB retrieval fails silently.
- **boto3 in the invoking Lambda must be >= 1.39** to know the `bedrock-agentcore` client; build that client with a long read timeout (`read_timeout=540`) and `retries={"max_attempts": 0}` to avoid duplicate agent runs and premature read timeouts.
- **AgentCore response is double-wrapped**: `json.loads` the outer string → strip the ```json fence → `json.loads` the inner object.
- **Denied topics must be concrete.** Define them as specific off-topic domains (personal finance, entertainment, creative writing, individual medical advice) with positive examples — never "anything unrelated to public health," which false-positives and blocks legitimate curriculum questions.
- **KMS-encrypted bucket presigning** requires SigV4 — build the S3 client with `Config(signature_version="s3v4")` for both uploads and exports.
