// Generates cloud/aws-lambda/template.json (CloudFormation) with the workload
// runner inlined. Run after editing cloud/aws-lambda/runner.cjs:
//   node scripts/build-aws-template.mjs
// tests/cloud/aws-lambda.test.ts fails if the committed template is stale.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(root, 'cloud', 'aws-lambda', 'runner.cjs');
const outPath = path.join(root, 'cloud', 'aws-lambda', 'template.json');

export function buildTemplate(runnerSource) {
  if (Buffer.byteLength(runnerSource) >= 4096) throw new Error('runner.cjs must stay under 4096 bytes to be inlined (ZipFile limit)');
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'COMPUTLESS AWS Lambda workload runner and a dispatcher role that can only invoke it.',
    Parameters: {
      FunctionName: { Type: 'String', Default: 'computless-runner-js' },
      MemorySize: { Type: 'Number', Default: 1024, MinValue: 128, MaxValue: 10240 },
      ReservedConcurrency: {
        Type: 'Number',
        Default: 0,
        MinValue: 0,
        Description: 'Cap on concurrent runs. 0 = no reservation (new accounts with a 10-concurrency quota cannot reserve any).',
      },
      DispatcherTrustedPrincipal: {
        Type: 'String',
        Default: '',
        Description: 'ARN allowed to assume the dispatcher role (e.g. the COMPUTLESS server role). Empty = IAM principals in this account that are granted sts:AssumeRole on it.',
      },
      CreateBootstrapUser: {
        Type: 'String',
        Default: 'false',
        AllowedValues: ['true', 'false'],
        Description: 'Create an IAM user whose only permission is assuming the dispatcher role (for a COMPUTLESS server outside AWS). Create its access key yourself; it is never put in stack outputs.',
      },
    },
    Conditions: {
      HasReservedConcurrency: { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'ReservedConcurrency' }, 0] }] },
      HasTrustedPrincipal: { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'DispatcherTrustedPrincipal' }, ''] }] },
      MakeBootstrapUser: { 'Fn::Equals': [{ Ref: 'CreateBootstrapUser' }, 'true'] },
    },
    Resources: {
      RunnerExecutionRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          Description: 'COMPUTLESS runner: may only write its own logs.',
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          Policies: [
            {
              PolicyName: 'own-logs-only',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: { 'Fn::GetAtt': ['RunnerLogGroup', 'Arn'] },
                  },
                ],
              },
            },
          ],
        },
      },
      RunnerLogGroup: {
        Type: 'AWS::Logs::LogGroup',
        Properties: { LogGroupName: { 'Fn::Sub': '/aws/lambda/${FunctionName}' }, RetentionInDays: 14 },
      },
      RunnerFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: { Ref: 'FunctionName' },
          Description: 'COMPUTLESS workload runner (fresh V8 context per run, no string code generation).',
          Runtime: 'nodejs22.x',
          Architectures: ['arm64'],
          Handler: 'index.handler',
          MemorySize: { Ref: 'MemorySize' },
          Timeout: 20,
          Role: { 'Fn::GetAtt': ['RunnerExecutionRole', 'Arn'] },
          LoggingConfig: { LogGroup: { Ref: 'RunnerLogGroup' } },
          ReservedConcurrentExecutions: {
            'Fn::If': ['HasReservedConcurrency', { Ref: 'ReservedConcurrency' }, { Ref: 'AWS::NoValue' }],
          },
          Code: { ZipFile: runnerSource },
        },
      },
      DispatcherRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          Description: 'COMPUTLESS dispatcher: may only invoke the runner function.',
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  AWS: {
                    'Fn::If': ['HasTrustedPrincipal', { Ref: 'DispatcherTrustedPrincipal' }, { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:root' }],
                  },
                },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'invoke-runner-only',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: { 'Fn::GetAtt': ['RunnerFunction', 'Arn'] } }],
              },
            },
          ],
        },
      },
      BootstrapUser: {
        Type: 'AWS::IAM::User',
        Condition: 'MakeBootstrapUser',
        Properties: {
          Policies: [
            {
              PolicyName: 'assume-dispatcher-only',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Resource: { 'Fn::GetAtt': ['DispatcherRole', 'Arn'] } }],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      FunctionArn: { Description: 'Set as COMPUTLESS_AWS_FUNCTION_ARN', Value: { 'Fn::GetAtt': ['RunnerFunction', 'Arn'] } },
      DispatcherRoleArn: { Description: 'Set as COMPUTLESS_AWS_ROLE_ARN', Value: { 'Fn::GetAtt': ['DispatcherRole', 'Arn'] } },
      BootstrapUserName: {
        Condition: 'MakeBootstrapUser',
        Description: 'Create one access key for this user (IAM console) and store it in the server secret store',
        Value: { Ref: 'BootstrapUser' },
      },
    },
  };
}

export function renderTemplate(runnerSource) {
  return JSON.stringify(buildTemplate(runnerSource), null, 2) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(outPath, renderTemplate(fs.readFileSync(runnerPath, 'utf8')));
  console.log(`wrote ${path.relative(root, outPath)}`);
}
