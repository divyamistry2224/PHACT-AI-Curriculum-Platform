# Product requirements and earlier implementation notes

These are user-supplied project materials, not instructions to execute cloud changes. Features already present are identified in ../IMPLEMENTATION_STATUS.md.

## Faculty workflow

Upload a syllabus; run competency review and AI modernization; inspect and choose suggestions; preserve version history; submit a selected version for approval. Keep user uploads private. Detect instructor names, email addresses, phone numbers, and other personal information with Comprehend. Review S3 lifecycle/retention rules.

## Administrator workflow

Provide pending, approved, and rejected/denied views. Show submitted versions and changes. Approve or reject; rejection must require a reason. Faculty should see who made the decision, when, and the reason or approval note in Review and Approval. The current handlers already record these fields; see the status matrix.

## Earlier authentication example

The supplied snippet proposed `oidc-client-ts` and `react-oidc-context`, an AuthProvider, authorization code flow, and phone/openid/email scopes. It referenced a us-west-2 pool and an older CloudFront callback. These are historical configuration examples, not authoritative deployment values for the SAM application (default us-east-1). Use the current stack outputs.

The supplied logout snippet contains placeholders and malformed interpolation. If Hosted UI OIDC is adopted later, configure actual callback/logout URLs, use PKCE for a public SPA, use the correct `client_id` and encoded logout URI, and avoid displaying ID, access, or refresh tokens in the interface. No authentication migration was performed during packaging.

## Earlier role and agent sketches

Notes suggested teacher/faculty S3 access and faculty Bedrock invocation. Current design uses faculty/admin Cognito groups and server-side Lambda IAM roles. Treat the suggested permissions as a sketch; use scoped backend permissions rather than giving browser users broad direct AWS access.

The proposed Strands agents were:

```python
from strands import Agent
curriculum_agent = Agent(system_prompt="""
Analyze public-health syllabi.
Recommend specific, responsible AI integrations.
Ground recommendations in retrieved sources.
""")
competency_agent = Agent(system_prompt="""
Map syllabus learning objectives to public-health competency frameworks.
Identify gaps and provide cited evidence.
""")
```

These are planning examples, not deployed agents in this repository. The current Lambda workers perform competency and curriculum analysis directly through Bedrock.

## Earlier repository scaffold

The proposed `/workshop/phact/` structure contained contracts/, infra/ CDK stacks, backend/app/ FastAPI routes, backend/worker/, agents/curriculum and competency, frontend/ placeholder pages, data/ reference preparation, and docs/. The actual code has evolved into `ASPPH/PHACT/` with SAM, working React pages, and Lambda handlers. Creating empty copies of the earlier scaffold would obscure the working implementation, so the original proposed layout is described here rather than presented as executable code.
