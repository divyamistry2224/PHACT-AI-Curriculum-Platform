# AgentCore review connection

The application review path is:

```text
React → API Gateway → start-review Lambda → SQS → review worker
  → configured AgentCore runtime → Strands agents / Bedrock retrieval
  → native review result → guardrails → saved proposal → faculty decisions
```

`backend/shared/phact/agentcore.py` invokes the runtime using the review ID and stored syllabus owner. It accepts only matching successful results, requires all 22 competency grades for a competency review, and resolves peer citations from the runtime's evidence catalogue. Failed or blocked calls release the review lock without saving a version. The worker does not silently fall back to a second model run.

The runtime's `review_type` input selects the native SAM review contract. It receives screened faculty guidance and declined suggestions. `samReview` includes competency grades and changes, or modernization recommendations, plus the revised syllabus. Existing output guardrails, diffs, faculty choices, and approval rules still run in the SAM worker.

SAM review requests return results to the caller without triggering the runtime's standalone post-processing or DynamoDB workflow. The application owns persistence and versioning.

## Enable an existing runtime

1. Deploy the updated `ASPPH/PHACT/agents/` runtime with the `COMPETENCY_KB_ID`, `SYLLABUS_KB_ID`, model, guardrail, and corpus configuration described in its README. Knowledge-base metadata must match the runtime's ACTIVE/corpus-version retrieval filters; existing SAM KB content may need prepared metadata and ingestion first.
2. Obtain the deployed runtime ARN from AgentCore. An older runtime without `samReview` support must be updated before the workers select it.
3. In the AWS deployment session, set the ARN and deploy the SAM application:

```bash
cd ASPPH/PHACT
export PHACT_AGENTCORE_RUNTIME_ARN='YOUR_DEPLOYED_RUNTIME_ARN'
./scripts/deploy.sh
```

The template passes the ARN to both workers and grants invocation permissions scoped to that runtime. The runtime execution role needs its own Bedrock, retrieval, Comprehend, and guardrail permissions.

The ARN parameter defaults to empty, preserving direct Bedrock for existing deployments. To switch a configured stack back, explicitly set the CloudFormation parameter `AgentCoreRuntimeArn` to an empty value when deploying. Merely unsetting the shell variable does not clear an existing stack parameter.

## Validation

95 backend tests and 34 RAG tests passed with mocked services and scripted agents. Coverage includes both queued review types, faculty decisions, missing/duplicate grades, invalid result identities, blocked/failed calls, citation filtering, and native output generation. SAM template validation and shell syntax checks are run separately.

These repository changes have not been deployed to the team's AWS account. The live runtime ARN and a deployment session are required to activate and verify the connection there.
