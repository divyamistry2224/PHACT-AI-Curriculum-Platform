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
  agents/               Three-agent RAG runtime and corpus preparation
  contracts/            Analysis JSON schema and example
  template.yaml         AWS infrastructure
  scripts/              Deployment and integration checks
  tests/                Backend tests and local browser harness
  data/                 Competency references and synthetic syllabi
ASPPH/Data/             Reference documents
archive/frontend/   Earlier frontend implementation
ASPPH/PHACT UX-UI Design/
docs/
  architecture/         Architecture diagram and editable source
  presentation/         Presentation deck
  branding/             Project logo
  api/                  API workbook and CSV exports
  research/             Faculty discovery interview guide
  planning/             Requirements and proposed improvements
```

## RAG pipeline

The [agents module](ASPPH/PHACT/agents/) contains the three-agent Strands workflow, AgentCore entrypoint, reference corpus preparation, citation validation, and DOCX/PDF post-processing.

- [Pipeline](ASPPH/PHACT/agents/phact_agents/pipeline.py)
- [Retrieval and evidence](ASPPH/PHACT/agents/phact_agents/evidence.py)
- [Corpus preparation CLI](ASPPH/PHACT/agents/phact_rag/__main__.py)
- [Analysis contract](ASPPH/PHACT/contracts/analysis.schema.json)
- [Setup and tests](ASPPH/PHACT/agents/README.md)

The queued review workers support the AgentCore runtime through a native review adapter. Faculty decisions, version history, and administrator approval use the same application workflow. See [AgentCore configuration](docs/AGENTCORE.md).

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

Working application built for AWS Breaking Barriers 2026, with faculty and administrator workflows, background reviews, and version history. Automated checks cover **95 backend tests and 34 RAG tests**, using mocked AWS services and scripted agent responses.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for current features and planned work.
