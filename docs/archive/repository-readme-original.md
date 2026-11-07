# PHACT: Public Health AI Curriculum Transformation

PHACT helps public health faculty update their syllabi. A faculty member uploads a syllabus, and PHACT:

1. Grades it against the 22 CEPH foundational competencies and suggests changes for the gaps.
2. Recommends ways to bring AI into the course responsibly, or to make assessments AI-resistant, citing syllabi other faculty have had approved.
3. Lets the faculty member accept, decline, or edit each suggestion. Every accepted set becomes a new version.
4. Sends the finished syllabus to an ASPPH admin. An approved syllabus joins the shared library that later reviews draw peer examples from.

Built for AWS Breaking Barriers 2026 with synthetic data only. Everything runs serverless in one AWS SAM stack.

## Architecture

![PHACT architecture](docs/architecture.png)

The diagram source is [`docs/architecture.drawio`](docs/architecture.drawio). Open it at [app.diagrams.net](https://app.diagrams.net) to edit it.

**Front door.** CloudFront serves the React app from a private S3 bucket. Users sign in with Cognito, which returns a signed ID token (a JWT) carrying the user's ID, email, and group (`faculty` or `admin`). Every API call sends that token, and API Gateway's Cognito authorizer checks it before any Lambda runs.

**Faculty flow.**
- **Upload:** a Lambda extracts the text. Bedrock Guardrails rejects off-topic content, and Amazon Comprehend permanently replaces personal details with labels such as `[name removed]`. Then the original file is deleted.
- **Review:** reviews run asynchronously. A start Lambda queues the job in SQS, and the browser polls for status. A worker Lambda retrieves the CEPH competencies (KB1) and approved peer syllabi (KB2) from Bedrock Knowledge Bases and asks Claude on Amazon Bedrock for proposed changes. The guardrail checks Claude's output too.
- **Decide:** the faculty member's choices are saved as the next version. Faculty can re-run a review with their own instructions, and suggestions they declined before aren't repeated.

**Admin flow.**
- **Approve:** the admin sees an AI-written summary of the changes. Approving runs the PII purge a second time and writes the syllabus to the knowledge base source bucket. An S3 event goes through SQS to a Sync Lambda, which ingests it into KB2.
- **Reject:** the admin must leave notes, which the faculty member sees.
- **Emails:** either decision changes the syllabus status in DynamoDB. A DynamoDB Stream, filtered to just those changes, triggers a Lambda that emails the faculty member through Amazon SES.

**Data.** DynamoDB holds syllabi, reviews, and feedback. The admin approval queue is an index on the Syllabi table. Every version is stored in an S3 bucket encrypted with KMS. Syllabi and their versions expire after 180 days, except approved syllabi, which stay in the shared library.

| Concern | Service |
| --- | --- |
| Hosting | Amazon CloudFront, Amazon S3 |
| Sign-in and roles | Amazon Cognito (user pool with `faculty` and `admin` groups) |
| API | Amazon API Gateway (REST) with a Cognito authorizer, about 18 AWS Lambda functions (Python 3.12) |
| Async work | Amazon SQS (review queues, knowledge base sync queue) |
| AI | Amazon Bedrock: Claude, Guardrails, Knowledge Bases with Amazon S3 Vectors and Titan embeddings |
| Personal data | Amazon Comprehend PII detection |
| Data | Amazon DynamoDB (with a Stream), Amazon S3 |
| Email | Amazon SES |

## Deploy

### Prerequisites

- AWS CLI v2, signed in to the target account (`aws sts get-caller-identity` works)
- AWS SAM CLI (`brew install aws-sam-cli`)
- Python 3.12
- Node 22 and pnpm (`brew install node@22 pnpm`) to build the front end. Without them, the backend still deploys and the front end step is skipped with a message.
- Amazon Bedrock access in `us-east-1` to the Claude model you choose and to Titan Text Embeddings V2

### Run the deploy script

```bash
cd ASPPH/PHACT
export AWS_PROFILE=<your profile>                   # if not your default
export PHACT_MODEL_ID=<Claude inference profile>    # optional; defaults to Claude Sonnet 4.5
export PHACT_FACULTY_PASSWORD='<12+ chars, upper, lower, number>'
export PHACT_ADMIN_PASSWORD='<12+ chars, upper, lower, number>'
./scripts/deploy.sh
```

The script:

1. Builds and deploys the `phact` stack to `us-east-1` with `sam build` and `sam deploy`.
2. Saves the stack outputs to `.phact/outputs.json`.
3. Uploads the CEPH competency files, which starts the KB1 ingestion.
4. Creates the demo users `faculty@phact.demo` and `admin@phact.demo` with your passwords.
5. Checks the API's `/health` endpoint.
6. Builds the front end against the new stack, uploads it to S3, and refreshes CloudFront.

It ends by printing the web app's URL. Re-running it is safe, and only what changed is redeployed. The first deploy takes an extra 5 to 10 minutes while CloudFront rolls out.

Passwords are only read from environment variables. Never commit them.

### Optional settings

| Variable | What it does |
| --- | --- |
| `PHACT_NOTIFICATION_SENDER` | A sender address you can verify in SES. Without it, decision emails are built and recorded as "not sent". In the SES sandbox, recipients must be verified too. |
| `PHACT_ALLOWED_ORIGIN` | The browser origin allowed by CORS (default `*`) |
| `PHACT_DATA_MODE` | `live` (default) calls the API. `mock` builds the front end with simulated data. |
| `PHACT_SKIP_FRONTEND` | Set to anything to deploy the backend only |
| `STACK_NAME`, `AWS_REGION` | Default `phact` and `us-east-1` |

### After the first deploy

Seed the shared library so AI recommendations have peer examples to cite. This runs once per new stack:

```bash
python3 scripts/seed_kb2.py      # uploads, submits, and approves the seed syllabi
python3 scripts/kb_check.py      # confirms both knowledge bases can be searched
```

`scripts/` also has end-to-end checks against the deployed stack: `smoke_test.py`, `review_test.py`, and `approval_test.py`.

## Repository layout

```
template.yaml        All infrastructure (SAM / CloudFormation), including front end hosting
samconfig.toml       SAM defaults
backend/functions/   One folder per Lambda function
backend/shared/      Lambda layer: data access, reviews, PII purge, guardrail, auth
frontend/            React app (Vite); its docs are in frontend/docs/
data/                CEPH competency files and synthetic seed syllabi
scripts/             deploy.sh, seeding, and deploy checks
tests/               Unit tests with mocked AWS; tests/e2e/ runs the app locally in a browser
docs/                Architecture diagram and the technical reference
```

## Testing

```bash
pip install "boto3>=1.39" "moto[dynamodb,s3]>=5" pytest pypdf
python3 -m pytest tests -q
```

`tests/e2e/` runs the real Lambda handlers on your machine with AWS mocked, and clicks through both roles in a headless browser. No AWS account is needed.

## More detail

[`docs/REFERENCE.md`](docs/REFERENCE.md) covers:
- how personal data is purged at each step
- how reviews become versions
- how approval and decision emails work
- data retention
- running the app locally
- every API endpoint and error code
