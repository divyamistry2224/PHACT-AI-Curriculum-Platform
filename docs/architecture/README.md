# Architecture: implemented prototype and earlier plans

The image and editable draw.io file were copied from the source repository. The architecture image pasted in chat was not available as a separate downloadable image file; the repository's diagram and the supplied presentation are included instead.

## Current code path

```mermaid
flowchart TD
  U[Faculty / admin] --> CF[CloudFront + S3 React app]
  CF --> C[Cognito sign-in]
  CF --> API[API Gateway Cognito authorizer]
  API --> L[Python Lambda handlers]
  L --> D[DynamoDB state]
  L --> S[S3 versions]
  L --> Q[SQS review queues]
  Q --> W[Review Lambda workers]
  W --> KB[Bedrock Knowledge Bases: CEPH + approved syllabi]
  W --> M[Claude via Bedrock]
  W --> G[Comprehend + Guardrails]
  W --> S
  W --> D
  L --> A[Admin approval / rejection]
  A --> KBS[S3 approved syllabus source]
  KBS --> SY[SQS + sync Lambda]
  SY --> KB
  D --> ST[DynamoDB Stream]
  ST --> N[Decision notifier + SES]
```

Authority: `ASPPH/PHACT/template.yaml`, `backend/functions/`, and `backend/shared/phact/`.

## Earlier design material

The user supplied a CDK/FastAPI/Strands/AgentCore scaffold and OIDC Hosted UI snippets. Those differ from the inspected implementation: SAM infrastructure, individual Lambda handlers, direct Bedrock calls, and Cognito `USER_PASSWORD_AUTH` with token refresh. They are retained as requirements context, not inserted into the application.

The separate RAG notes describe a reusable Retrieve + Converse module and async adapter. That module's source was not supplied, so it is not represented as integrated or deployed.

## Review lifecycle

Faculty upload → background review → per-suggestion decisions → saved version → submit → pending admin queue → approve or deny. Rejection requires a reason; decisions record administrator identity and time. Approved content is copied to the KB source and synchronized. Review execution and human approval are separate states.

The original chat diagram proposed deleting rejected N+1 drafts. Current code instead composes accepted suggestions, does not create a version when everything is declined, and has constrained undo. See the implementation, not the old diagram, for actual behavior.
