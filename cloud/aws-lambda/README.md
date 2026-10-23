# AWS Lambda runner: setup and verification runbook

COMPUTLESS can run sandbox workloads on AWS Lambda (`"provider": "aws-lambda"` on
`POST /api/substrate/sandbox/execute`). CAPPO authorizes each run with the provider in
the request, and the Gnomledger event carries AWS's receipt (request id, billed
duration, max memory used).

**Status: built, not yet operated.** No workload has run on a real AWS account yet.
Steps 1–5 below are what turns it on, and step 5 proves it. Until then COMPUTLESS
reports `aws-lambda` as not configured and refuses those runs.

## What credentials are involved

| Who | Credential | Permissions | Where it lives |
| --- | --- | --- | --- |
| You, once, to deploy | Your admin sign-in (IAM Identity Center or an admin IAM user, **not root**) | Create the stack | AWS CloudShell session; nothing to store |
| The runner function | Its execution role (created by the stack) | Write its own log group only | AWS; the workload never sees it (each run gets an empty env) |
| The COMPUTLESS server, per run | Dispatcher role (created by the stack) | `lambda:InvokeFunction` on the runner only | Assumed per run; short-lived |
| The COMPUTLESS server, to assume that role | **Either** the server's own IAM role (server on AWS) **or** the bootstrap user's access key (server elsewhere) | `sts:AssumeRole` on the dispatcher role only | Server's secret store / env |

That last row is the only long-lived secret, and it only exists if the server runs
outside AWS. A leaked key can start the runner and nothing else; rotate it within 90 days.

## Checklist

### 1. Account safety (AWS console, once)
- [ ] Root user has MFA; daily work uses IAM Identity Center or an admin IAM user with MFA.
- [ ] **Billing → Budgets**: a monthly cost budget (e.g. $20) with an email alert.
- [ ] Pick one region (e.g. `us-east-1`) and use it everywhere below.

### 2. Deploy and verify the AWS side (one command)
In the AWS console, open **CloudShell** (top bar, `>_` icon), in your chosen region.
**Actions → Upload file**: upload `template.json` and `deploy.sh` from this folder. Then:

```sh
bash deploy.sh --create-access-key   # COMPUTLESS server runs outside AWS
bash deploy.sh                       # COMPUTLESS server runs on AWS (uses its own role)
```

It stops at the first failure. When it finishes, all of these have been checked
against your real account:

1. you are not signed in as root
2. the stack deployed (function, runner role, dispatcher role, optional bootstrap user)
3. the function ran a workload and returned the right answer
4. the dispatcher role can invoke the function and is refused anything else
5. (`--create-access-key`) the new key → assume role → invoke chain works, the exact path the server uses

It writes `computless-aws.env` (no secrets) and, with `--create-access-key`,
`computless-aws.secrets.env` (mode 600; the secret is never printed).

- [ ] `deploy.sh` ended with `Done.` and no `FAIL` lines.
- [ ] **Actions → Download file** both env files, then delete them from CloudShell:
      `rm computless-aws.secrets.env`.

### 3. Give the settings to the COMPUTLESS server
The variables are documented in `computless-aws.env.example`.

- [ ] Put both files on the server **outside the repo**, readable only by the service account
      (Linux: `chmod 600`; Windows: only your user and SYSTEM on the file's ACL).
- [ ] Docker Compose: add them to the COMPUTLESS service:
      ```yaml
      env_file:
        - ./computless-aws.env
        - ./computless-aws.secrets.env   # omit when the server runs on AWS
      ```
- [ ] Restart the service.

> **Staging today runs a different build.** The `veklom/fabric-computless:candidate`
> image on staging is built from the local `own-your-cloud` repo, not from this repo.
> These settings do nothing there until this COMPUTLESS build is what's deployed.

### 4. Check the server sees it
- [ ] `GET <server>/api/providers` shows `aws-lambda` with `"configured": true` and `"missing": []`.

### 5. Prove a real governed run end to end
From any machine with Node 20+ that can reach the server:

```sh
node scripts/aws-smoke.mjs --url http://127.0.0.1:23000
```

It sends one workload with a fresh random nonce and passes only if:

- the answer is right (computed from the nonce, so it can't be a cached or canned result)
- AWS returned a request id, and the function saw **the same id while running**
- CAPPO approved it, Gnomledger recorded it, the ledger event carries the same AWS
  request id, and the ledger chain still verifies
- the server's run log lists it as ran on `aws-lambda` with that request id

Exit codes: `0` PASS, `1` FAIL, `3` PARTIAL (server in `local` mode, so CAPPO and
Gnomledger could not be checked; that is **not** a pass).

- [ ] `PASS: 12/12`. Keep the output: it is the first real evidence that this works.
- [ ] Cross-check in AWS: **CloudWatch → Log groups → /aws/lambda/computless-runner-js**
      has a `REPORT RequestId: <same id>` line.

### 6. Afterwards
- [ ] Rotate the bootstrap key within 90 days: create a new one in IAM, update the
      server, run the smoke test, delete the old key.
- [ ] To remove everything: `aws cloudformation delete-stack --stack-name computless-runner`
      (delete the bootstrap user's access keys first, or the stack delete will fail).

## What the runner does

`runner.cjs` is the Lambda function, inlined into `template.json` by
`scripts/build-aws-template.mjs`. Each run is a new child Node process with:

- an empty environment, so no AWS credentials
- the Node permission model
- a 128 MB heap cap
- string code generation disabled
- an inner-realm global
- a kill at the deadline

Lambda itself runs the function in a Firecracker microVM, and warm environments are
reused between runs. There is no hardware attestation, and COMPUTLESS never claims any
for Lambda.

## Editing the runner

Edit `runner.cjs`, run `npm run build:aws-template`, then rerun `deploy.sh`. The test
suite fails if `template.json` is stale or the runner reaches 4096 bytes.
