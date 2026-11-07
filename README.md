# PHACT — Public Health AI Curriculum Transformation Platform

![PHACT logo](docs/branding/phact-logo-2.png)

PHACT helps public health educators review syllabi, identify competency gaps, and integrate AI responsibly. Faculty can review suggested changes, save revised versions, and submit a syllabus for administrator approval.

Built for **AWS Breaking Barriers 2026** by **Team 34 — Health PHACTory**.

[Live demo](https://donsewldp7xyg.cloudfront.net/) · [Presentation](docs/presentation/PHACT_Presentation_v13.pptx) · [API contract](docs/api/PHACT_API_Contract.xlsx)

## Features

- Upload a PDF, DOCX, or pasted syllabus.
- Review coverage of the 22 CEPH foundational competencies.
- Get AI integration and assessment recommendations grounded in retrieved sources.
- Accept, decline, or edit suggestions and compare syllabus versions.
- Submit revisions for administrator approval, with reasons required for rejection.
- Add approved syllabi to the shared knowledge base.
- Export revised syllabi as DOCX or PDF.

## Architecture

![PHACT architecture](docs/architecture/architecture.png)

The React app is hosted on S3 through CloudFront, with Cognito for sign-in. API Gateway and Python Lambda functions handle uploads and reviews. SQS queues background analysis, while Amazon Bedrock retrieves reference material and generates recommendations. DynamoDB stores review state, S3 stores syllabus versions, and Comprehend and Bedrock Guardrails support personal data handling and content checks.

[Editable architecture diagram](docs/architecture/architecture.drawio)

## Tech stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Python, AWS Lambda, API Gateway
- **AI:** Amazon Bedrock, Knowledge Bases, Guardrails, Amazon Comprehend
- **Storage and processing:** S3, DynamoDB, SQS
- **Authentication and hosting:** Cognito, CloudFront
- **Infrastructure:** AWS SAM / CloudFormation

## Project structure

```text
ASPPH/PHACT/
  frontend/             React application
  backend/              Lambda functions and shared services
  template.yaml         AWS infrastructure
  scripts/              Deployment and integration checks
  tests/                Backend tests and local browser harness
  data/                 Competency references and synthetic syllabi
ASPPH/Data/             Reference documents
ASPPH/PHACT UX-UI Design/
docs/
  architecture/         Architecture diagram and editable source
  presentation/         Presentation deck
  branding/             Project logo
  api/                  API workbook and CSV exports
  research/             Faculty discovery interview guide
  planning/             Requirements and proposed improvements
```

## Run locally

Requires Node.js 22.12+ and pnpm.

```bash
cd ASPPH/PHACT/frontend
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

The default configuration uses mock data without AWS. See the [application README](ASPPH/PHACT/README.md) for live API configuration, backend tests, and deployment.

## Project status

Hackathon prototype with faculty and administrator workflows, background reviews, and version history. The backend test suite passed **87 tests using mocked AWS services**. Live model quality and processing time require separate evaluation.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for current features and planned work.
