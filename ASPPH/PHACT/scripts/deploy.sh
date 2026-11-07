#!/usr/bin/env bash
# Deploys PHACT end to end. Run from anywhere: ./scripts/deploy.sh
#
# Environment variables:
#   AWS_PROFILE              Profile for the sandbox account (optional if your default works)
#   PHACT_AGENTCORE_RUNTIME_ARN  Existing AgentCore runtime with SAM review support (optional)
#   PHACT_MODEL_ID           Claude inference profile ID (default: template default)
#   PHACT_FACULTY_PASSWORD   Password for the demo faculty user (skip user creation if unset)
#   PHACT_ADMIN_PASSWORD     Password for the demo admin user (skip user creation if unset)
#   PHACT_ALLOWED_ORIGIN     Browser origin for CORS (default "*")
#   PHACT_NOTIFICATION_SENDER  Verified SES address for approval/denial emails (optional; see README)
#   PHACT_DATA_MODE          Front end data mode baked into the build: live (default) or mock
#   PHACT_SKIP_FRONTEND      Set to anything to skip the front end build and upload
#   STACK_NAME               Default "phact"
#   AWS_REGION               Default "us-east-1"
#
# Passwords need 12+ characters with upper, lower, and a number. Never commit them.
set -euo pipefail

cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-phact}"
REGION="${AWS_REGION:-us-east-1}"
FACULTY_EMAIL="${PHACT_FACULTY_EMAIL:-faculty@phact.demo}"
ADMIN_EMAIL="${PHACT_ADMIN_EMAIL:-admin@phact.demo}"

step() { printf '\n==> %s\n' "$*"; }

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

step "Checking credentials"
aws sts get-caller-identity --query Account --output text >/dev/null

step "Building (sam build)"
sam build

step "Deploying stack $STACK_NAME to $REGION (sam deploy)"
OVERRIDES=()
[[ -n "${PHACT_AGENTCORE_RUNTIME_ARN:-}" ]] && OVERRIDES+=("AgentCoreRuntimeArn=$PHACT_AGENTCORE_RUNTIME_ARN")
[[ -n "${PHACT_MODEL_ID:-}" ]] && OVERRIDES+=("ModelId=$PHACT_MODEL_ID")
[[ -n "${PHACT_ALLOWED_ORIGIN:-}" ]] && OVERRIDES+=("AllowedOrigin=$PHACT_ALLOWED_ORIGIN")
[[ -n "${PHACT_NOTIFICATION_SENDER:-}" ]] && OVERRIDES+=("NotificationSenderEmail=$PHACT_NOTIFICATION_SENDER")
if (( ${#OVERRIDES[@]} )); then
  sam deploy --stack-name "$STACK_NAME" --region "$REGION" --parameter-overrides "${OVERRIDES[@]}"
else
  sam deploy --stack-name "$STACK_NAME" --region "$REGION"
fi

step "Reading stack outputs"
API_URL="$(output ApiUrl)"
USER_POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"
mkdir -p .phact
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" --output json > .phact/outputs.json
echo "API:        $API_URL"
echo "User pool:  $USER_POOL_ID"
echo "App client: $CLIENT_ID"

step "Uploading CEPH competency files (KB1 ingestion starts within about a minute)"
KB_BUCKET="$(output KbSourceBucketName)"
# Only changed files upload, so a redeploy with no CEPH changes triggers no ingestion.
aws s3 sync data/ceph/ "s3://$KB_BUCKET/ceph/" --region "$REGION" --exclude "competencies.json" --delete

ensure_user() {
  local email="$1" group="$2" password="$3" name="$4"
  if ! aws cognito-idp admin-get-user --region "$REGION" --user-pool-id "$USER_POOL_ID" --username "$email" >/dev/null 2>&1; then
    aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$USER_POOL_ID" --username "$email" \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
      --message-action SUPPRESS >/dev/null
  fi
  # The display name shows in the web app (it comes through in the ID token's "name" claim).
  aws cognito-idp admin-update-user-attributes --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$email" --user-attributes Name=name,Value="$name"
  aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$email" --password "$password" --permanent
  aws cognito-idp admin-add-user-to-group --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$email" --group-name "$group"
  echo "Ready: $email ($group)"
}

step "Demo users"
if [[ -n "${PHACT_FACULTY_PASSWORD:-}" ]]; then
  ensure_user "$FACULTY_EMAIL" faculty "$PHACT_FACULTY_PASSWORD" "${PHACT_FACULTY_NAME:-Dr. Maya Chen}"
else
  echo "Skipped faculty user: set PHACT_FACULTY_PASSWORD to create it."
fi
if [[ -n "${PHACT_ADMIN_PASSWORD:-}" ]]; then
  ensure_user "$ADMIN_EMAIL" admin "$PHACT_ADMIN_PASSWORD" "${PHACT_ADMIN_NAME:-ASPPH Administrator}"
else
  echo "Skipped admin user: set PHACT_ADMIN_PASSWORD to create it."
fi

step "Health check"
curl -fsS "$API_URL/health" && echo

deploy_frontend() {
  local bucket distribution mode node_major
  bucket="$(output FrontendBucketName)"
  distribution="$(output FrontendDistributionId)"
  mode="${PHACT_DATA_MODE:-live}"
  if [[ -n "${PHACT_SKIP_FRONTEND:-}" ]]; then
    echo "Skipped: PHACT_SKIP_FRONTEND is set."; return
  fi
  if [[ ! -f frontend/package.json ]]; then
    echo "Skipped: no frontend/ folder next to template.yaml."; return
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Skipped: pnpm not found. Install it (brew install pnpm) and re-run."; return
  fi
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if (( node_major < 20 )); then
    echo "Skipped: the front end needs Node 20 or newer (found $(node -v 2>/dev/null || echo none))."; return
  fi

  echo "Building in $mode mode (PHACT_DATA_MODE=mock builds it with local sample data instead)"
  (
    cd frontend
    pnpm install --frozen-lockfile
    VITE_DATA_MODE="$mode" \
    VITE_API_BASE_URL="$API_URL" \
    VITE_AWS_REGION="$REGION" \
    VITE_USER_POOL_ID="$USER_POOL_ID" \
    VITE_USER_POOL_CLIENT_ID="$CLIENT_ID" \
      pnpm build
  )

  # Hashed bundles never change, so browsers keep them for a year. Old bundles stay in the bucket so a page
  # loaded before this deploy keeps working. index.html is always revalidated and goes last, so it never
  # points at a bundle that isn't uploaded yet.
  aws s3 sync frontend/dist/assets/ "s3://$bucket/assets/" --region "$REGION" --cache-control "public,max-age=31536000,immutable"
  aws s3 sync frontend/dist/ "s3://$bucket/" --region "$REGION" --delete --exclude "assets/*" --exclude "index.html" --cache-control "public,max-age=300"
  aws s3 cp frontend/dist/index.html "s3://$bucket/index.html" --region "$REGION" --cache-control "no-cache"
  aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/*" --query "Invalidation.Id" --output text >/dev/null
  echo "Front end: $(output FrontendUrl)"
}

step "Front end (build, upload to S3, refresh CloudFront)"
deploy_frontend

step "Done"
echo "Web app:  $(output FrontendUrl)"
echo "Next:"
echo "  python3 scripts/smoke_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx"
echo "  python3 scripts/kb_check.py --wait"
echo "  python3 scripts/review_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx"
echo "  python3 scripts/approval_test.py data/seed-syllabi/MPH_Syllabus_01_Northeast_Epidemiology.docx"
echo "  python3 scripts/seed_kb2.py      # once per new stack: approves the seed syllabi into KB2"
