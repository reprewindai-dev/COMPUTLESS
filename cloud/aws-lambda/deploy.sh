#!/usr/bin/env bash
# Deploys the COMPUTLESS Lambda runner and proves it works, in one command.
#
# Run it where the AWS CLI v2 is signed in as an admin of the target account
# (AWS CloudShell works: upload this file and template.json, then run it).
#
#   bash deploy.sh                      # deploy + verify, server runs on AWS (uses its own role)
#   bash deploy.sh --create-access-key  # also create the bootstrap user's key (server outside AWS)
#
# What it checks, in order, and stops at the first failure:
#   1. who you are signed in as (refuses the root user)
#   2. the CloudFormation stack deploys
#   3. the function runs a real workload (direct invoke as you)
#   4. the dispatcher role can invoke it, and can do nothing else
#   5. with --create-access-key: the new key -> assume role -> invoke chain the
#      COMPUTLESS server will use works end to end
#
# Writes computless-aws.env (no secrets). With --create-access-key it also
# writes computless-aws.secrets.env (mode 600). Secrets are never printed.
set -euo pipefail

STACK=computless-runner
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
TEMPLATE="$(cd "$(dirname "$0")" && pwd)/template.json"
TRUSTED_PRINCIPAL=""
RESERVED_CONCURRENCY=0
CREATE_KEY=false
OUT_DIR="$PWD"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Options:
  --region R                  AWS region (default: $AWS_REGION or the CLI's configured region)
  --stack NAME                CloudFormation stack name (default: computless-runner)
  --template PATH             template.json path (default: next to this script)
  --trusted-principal ARN     only this principal may assume the dispatcher role
  --reserved-concurrency N    cap concurrent runs (default 0 = no cap)
  --create-access-key         create the bootstrap user and one access key for it
  --out-dir DIR               where to write the env files (default: current dir)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --stack) STACK="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --trusted-principal) TRUSTED_PRINCIPAL="$2"; shift 2 ;;
    --reserved-concurrency) RESERVED_CONCURRENCY="$2"; shift 2 ;;
    --create-access-key) CREATE_KEY=true; shift ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$*"; }
ok() { printf '   OK  %s\n' "$*"; }
fail() { printf '   FAIL %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || fail "AWS CLI not found (use AWS CloudShell, or install AWS CLI v2)"
command -v python3 >/dev/null || fail "python3 not found (needed to check JSON results)"
[ -f "$TEMPLATE" ] || fail "template not found: $TEMPLATE"
[ -n "$REGION" ] || REGION="$(aws configure get region 2>/dev/null || true)"
[ -n "$REGION" ] || fail "no region: pass --region (e.g. us-east-1)"
if $CREATE_KEY && [ -n "$TRUSTED_PRINCIPAL" ]; then
  fail "--create-access-key needs the default trust (the bootstrap user must be able to assume the role); drop --trusted-principal"
fi
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Checks a runner response file: status SUCCESS and output.sum == 5.
check_result() {
  python3 - "$1" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
ok = r.get("status") == "SUCCESS" and (r.get("output") or {}).get("sum") == 5
print("   result: status=%s output=%s requestId=%s" % (r.get("status"), json.dumps(r.get("output")), (r.get("runtime") or {}).get("awsRequestId")))
if not ok:
    print("   error: %s" % json.dumps(r.get("error") or r), file=sys.stderr)
sys.exit(0 if ok else 1)
PY
}

PAYLOAD='{"code":"output.sum = input.a + input.b;","input":{"a":2,"b":3},"timeoutMs":3000}'

# invoke_as <label>: invokes the function with whatever credentials are in the environment.
invoke_as() {
  local out="$WORK/$1.json" ferr
  ferr="$(aws lambda invoke --function-name "$FUNCTION_ARN" --cli-binary-format raw-in-base64-out \
    --payload "$PAYLOAD" --query FunctionError --output text "$out")" || return 1
  [ "$ferr" = "None" ] || { echo "   Lambda FunctionError: $ferr $(cat "$out")" >&2; return 1; }
  check_result "$out"
}

step "1/5 Signed-in identity"
CALLER="$(aws sts get-caller-identity --query Arn --output text)" || fail "not signed in to AWS"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
case "$CALLER" in *":root") fail "signed in as the account root user; use an admin IAM user or IAM Identity Center instead" ;; esac
ok "$CALLER (account $ACCOUNT, region $REGION)"

step "2/5 Deploy stack $STACK"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "CreateBootstrapUser=$CREATE_KEY" \
    "ReservedConcurrency=$RESERVED_CONCURRENCY" \
    "DispatcherTrustedPrincipal=$TRUSTED_PRINCIPAL" \
  || fail "stack deploy failed; see: aws cloudformation describe-stack-events --stack-name $STACK"
output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
FUNCTION_ARN="$(output FunctionArn)"
ROLE_ARN="$(output DispatcherRoleArn)"
[ -n "$FUNCTION_ARN" ] && [ "$FUNCTION_ARN" != "None" ] || fail "stack has no FunctionArn output"
ok "function $FUNCTION_ARN"
ok "dispatcher role $ROLE_ARN"

step "3/5 Run a workload on the function (as you)"
invoke_as direct || fail "the function did not run the test workload"
ok "function ran the workload and returned the right answer"

# Runs "$@" with the dispatcher role's temporary credentials taken from the
# credentials of the current environment.
with_dispatcher() {
  local creds
  creds="$(aws sts assume-role --role-arn "$ROLE_ARN" --role-session-name computless-deploy-check \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)" || return 1
  (
    read -r AK SK ST <<<"$creds"
    export AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$ST"
    unset AWS_PROFILE AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_AUTHORIZATION_TOKEN
    "$@"
  )
}

step "4/5 Dispatcher role: can invoke, nothing else"
if [ -n "$TRUSTED_PRINCIPAL" ]; then
  echo "   SKIPPED: the role trusts only $TRUSTED_PRINCIPAL, so it can't be assumed from here."
else
  with_dispatcher invoke_as dispatcher || fail "the dispatcher role could not invoke the function"
  ok "dispatcher role invoked the function"
  if with_dispatcher aws lambda list-functions --max-items 1 >/dev/null 2>&1; then
    fail "the dispatcher role can list functions; it should only be able to invoke the runner"
  fi
  ok "dispatcher role is refused anything else (lambda:ListFunctions denied)"
fi

mkdir -p "$OUT_DIR"
ENV_FILE="$OUT_DIR/computless-aws.env"
cat >"$ENV_FILE" <<EOF
# COMPUTLESS AWS Lambda provider (no secrets in this file).
# Generated by cloud/aws-lambda/deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) for account $ACCOUNT.
COMPUTLESS_AWS_FUNCTION_ARN=$FUNCTION_ARN
COMPUTLESS_AWS_ROLE_ARN=$ROLE_ARN
AWS_REGION=$REGION
EOF

step "5/5 Server credentials"
if $CREATE_KEY; then
  USER_NAME="$(output BootstrapUserName)"
  [ -n "$USER_NAME" ] && [ "$USER_NAME" != "None" ] || fail "stack has no BootstrapUserName output"
  SECRETS_FILE="$OUT_DIR/computless-aws.secrets.env"
  [ -e "$SECRETS_FILE" ] && fail "$SECRETS_FILE already exists; move it away first (never overwrite a key you may still need)"
  KEYS="$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)"
  [ "$KEYS" -lt 2 ] || fail "$USER_NAME already has 2 access keys; delete an unused one in the IAM console first"
  (
    umask 077
    aws iam create-access-key --user-name "$USER_NAME" \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
      | awk '{ print "AWS_ACCESS_KEY_ID=" $1; print "AWS_SECRET_ACCESS_KEY=" $2 }' >"$SECRETS_FILE"
  ) || fail "could not create an access key for $USER_NAME"
  chmod 600 "$SECRETS_FILE"
  ok "created a key for $USER_NAME; written to $SECRETS_FILE (mode 600, not printed)"

  # The exact chain the server uses: this key -> assume the dispatcher role -> invoke.
  echo "   testing the new key (new IAM keys can take a few seconds to work)..."
  chain_ok=false
  for _ in 1 2 3 4 5 6 7 8; do
    if (
      set -a
      # shellcheck disable=SC1090  # the key file is created above at a runtime path
      . "$SECRETS_FILE"
      set +a
      unset AWS_SESSION_TOKEN AWS_PROFILE AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_AUTHORIZATION_TOKEN
      with_dispatcher invoke_as server-chain
    ) 2>"$WORK/chain.err"; then chain_ok=true; break; fi
    sleep "${COMPUTLESS_KEY_RETRY_SECONDS:-5}"
  done
  $chain_ok || { cat "$WORK/chain.err" >&2; fail "the new key could not assume the dispatcher role and invoke the function"; }
  ok "new key -> dispatcher role -> function works"
else
  echo "   No key created. If the COMPUTLESS server runs on AWS, allow its IAM role sts:AssumeRole"
  echo "   on $ROLE_ARN (and redeploy with --trusted-principal <that role's ARN>)."
  echo "   If it runs anywhere else, rerun with --create-access-key."
fi

SECRETS_LINE=""
if $CREATE_KEY; then
  SECRETS_LINE="Secret settings:     $OUT_DIR/computless-aws.secrets.env  (download it, put it in the server's secret store, then delete it here)"
fi
cat <<EOF

Done. Every step above ran against your real AWS account.

Non-secret settings: $ENV_FILE
$SECRETS_LINE

Next: give the COMPUTLESS server these settings, restart it, and run
  node scripts/aws-smoke.mjs --url <COMPUTLESS URL>
to prove a governed run goes through CAPPO, runs on Lambda and lands in Gnomledger.
EOF
