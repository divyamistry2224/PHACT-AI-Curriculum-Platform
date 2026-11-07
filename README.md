# PHACT — Public Health AI Curriculum Transformation Platform

![PHACT logo](docs/branding/phact-logo-1.png)

A faculty-led public health curriculum review prototype built for AWS Breaking Barriers 2026 by Team 34, Health PHACTory.

PHACT helps faculty review syllabi against CEPH foundational competencies, consider responsible AI integrations and AI-resistant assessments, inspect suggested edits, and submit a version for administrator review. Approved syllabi become peer examples in the shared knowledge base.

**Project status:** hackathon prototype with application code, infrastructure, and mocked AWS tests. The repository also contains design documents and future proposals. A live AWS deployment has not been independently verified in this packaging review. PHACT supports faculty judgment; it does not certify accreditation.

[Demo website](https://donsewldp7xyg.cloudfront.net/) · [Presentation](docs/presentation/PHACT_Presentation_v13.pptx) · [Architecture](docs/architecture/architecture.png) · [API workbook](docs/api/PHACT_API_Contract.xlsx) · [Implementation status](docs/IMPLEMENTATION_STATUS.md) · [GitHub upload guide](docs/UPLOAD_TO_GITHUB.md)

Demo availability depends on the team's AWS environment. Credentials are intentionally omitted.

## What the prototype does

- Upload PDF, DOCX, or pasted syllabus text.
- Scrub personal information using Amazon Comprehend and apply Bedrock Guardrails.
- Run background competency and AI modernization reviews.
- Accept, decline, or edit individual suggestions; save versions and compare changes.
- Submit a version for administrator approval or rejection with a required rejection reason.
- Show decision details and add approved syllabi to a Bedrock knowledge base.
- Export syllabus documents and collect faculty feedback.

These features have corresponding code; see the implementation matrix for evidence and verification limits. Real decision email delivery requires a verified SES sender and permitted recipient configuration.

## Architecture

![PHACT architecture](docs/architecture/architecture.png)

CloudFront serves the React app from S3. Cognito authenticates users, API Gateway authorizes requests, and Python Lambda handlers manage syllabi and reviews. SQS queues feed analysis workers. The workers use Bedrock Knowledge Bases and Claude through Bedrock. DynamoDB stores state, S3 stores versions, Comprehend scrubs PII, and Bedrock Guardrails checks content. Administrator approval feeds the approved syllabus knowledge base. A DynamoDB Stream triggers SES decision notifications when configured.

[Editable diagram](docs/architecture/architecture.drawio) · [Architecture explanation](docs/architecture/README.md)

## Repository map

```text
README.md
ASPPH/
  PHACT/                         # runnable application and infrastructure
    frontend/                    # React, TypeScript, Vite; live and mock API clients
    backend/functions/           # Python Lambda handlers
    backend/shared/              # shared auth, storage, reviews, PII, Bedrock helpers
    template.yaml                # AWS SAM / CloudFormation infrastructure
    scripts/                     # deployment, seeding and integration checks
    tests/                       # mocked AWS unit tests and local browser harness
    data/                        # CEPH material and synthetic seed syllabi
    docs/                        # original technical reference and diagrams
  Data/                          # original reference collection; review reuse rights
  PHACT UX-UI Design/             # original interface design image
  Technical Document_ASPPH_PHACT (MVP).md
  Vision Document_ASPPH_PHACT (MVP).md
docs/
  architecture/                  # diagram image, editable draw.io, explanation
  presentation/                  # supplied v13 deck and searchable slide text
  branding/                      # logos from the application repository
  api/                           # supplied workbook and CSV exports
  research/                      # discovery interview guide and initial insights
  planning/                      # requirements, RAG notes, gap analysis
  archive/                       # original root README
  IMPLEMENTATION_STATUS.md
  UPLOAD_TO_GITHUB.md
  PROVENANCE.md
  VERIFICATION.md
  FILE_MANIFEST.json
```

The original application paths are retained so deployment scripts, tests, and imports remain intact. The pasted `/workshop/phact` CDK scaffold is a historical plan, not this repository's runnable layout.

## Try the interface locally

Install Node.js 22.12+ and pnpm, then:

```bash
cd ASPPH/PHACT/frontend
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

The example selects `VITE_DATA_MODE=mock`: simulated data in the browser, no AWS needed. Open the localhost URL printed by Vite. Mock mode demonstrates the interface, not real inference.

For backend tests, live API configuration, and AWS deployment, use [the application README](ASPPH/PHACT/README.md). AWS deployment creates billable resources and is separate from publishing this GitHub repository.

## Evidence and supporting work

- [Presentation and speaker notes](docs/presentation/)
- [Faculty interview guide and discovery context](docs/research/faculty-discovery.md)
- [Requirements and proposed improvements](docs/planning/product-requirements.md)
- [RAG pipeline documentation supplied separately](docs/planning/rag-pipeline-notes.md)
- [RAG architecture review supplied separately](docs/planning/rag-architecture-gap-analysis.md)
- [Actual frontend API handoff](ASPPH/PHACT/frontend/docs/API_HANDOFF.md)
- [Actual backend API reference](ASPPH/PHACT/docs/REFERENCE.md)

The separate RAG source package described in the notes was not attached or found in the inspected branch. Its documented tests and extraction metrics are not verified here. The presentation includes targets and proposed source inspection features; these should not be represented as measured results or completed capabilities.

## Origin and attribution

Source: [NiikNiik/us-breaking-barriers-2026](https://github.com/NiikNiik/us-breaking-barriers-2026), itself a fork of the hackathon starter. This independent showcase imports the project snapshot and preserves team attribution and source provenance. The supplied deck credits David Clary, Claire Kao, Niko Ajani, Divya Mistry, and Saumit Guduguntla. This is a team project showcase.

No repository-wide license was found in the inspected branch. No new license has been assigned here. Reference documents and logos may have separate ownership or reuse restrictions; public availability does not establish permission to relicense them.
