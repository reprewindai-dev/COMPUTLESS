# AWS Lambda runner

COMPUTLESS can run sandbox workloads on AWS Lambda (`"provider": "aws-lambda"` on
`POST /api/substrate/sandbox/execute`). CAPPO authorizes the run with the provider
in the request, and the Gnomledger entry carries AWS's receipt (request id, billed
duration, max memory used).

## What gets created

`template.json` (CloudFormation) creates:

| Resource | Permissions |
| --- | --- |
| `computless-runner-js` Lambda (Node.js 22, arm64, 20 s timeout) | its execution role may only write its own log group |
| Dispatcher role | `lambda:InvokeFunction` on that one function, nothing else |
| Bootstrap user (only if `CreateBootstrapUser=true`) | `sts:AssumeRole` on the dispatcher role, nothing else |

The function code is `runner.cjs`, inlined by `scripts/build-aws-template.mjs`.
Each run is a new child process with an empty environment (so no AWS credentials),
the Node permission model, a 128 MB heap cap, string code generation disabled, and
a kill at the deadline. Lambda itself runs the function in a Firecracker microVM;
warm environments are reused between runs. There is no hardware attestation.

## Deploy

With the AWS CLI signed in to your account:

```sh
aws cloudformation deploy \
  --stack-name computless-runner \
  --template-file cloud/aws-lambda/template.json \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides CreateBootstrapUser=true

aws cloudformation describe-stacks --stack-name computless-runner \
  --query "Stacks[0].Outputs" --output table
```

Set the outputs on the COMPUTLESS server:

```
COMPUTLESS_AWS_FUNCTION_ARN=<FunctionArn>
COMPUTLESS_AWS_ROLE_ARN=<DispatcherRoleArn>
AWS_REGION=<region you deployed to>
```

If the server runs on AWS, give its role `sts:AssumeRole` on the dispatcher role and
deploy with `CreateBootstrapUser=false`. Otherwise create one access key for the
bootstrap user in the IAM console and put `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` in the server's secret store (never in git or chat).

`ReservedConcurrency` caps concurrent runs. New accounts with a 10-concurrency
quota cannot reserve any, so it defaults to 0 (no cap); set an AWS Budgets alert.

## Check it

`GET /api/providers` shows `aws-lambda` as configured. A run from the Run tab with
"Run on: AWS Lambda" returns the AWS request id and billed duration in the provider
receipt, and the same values appear in the Gnomledger event.

## Editing the runner

Edit `runner.cjs`, then run `npm run build:aws-template` and redeploy. The test
suite fails if `template.json` is stale or the runner reaches 4096 bytes.
