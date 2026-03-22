# Phase 4 Implementation Guide: CI/CD Pipeline & Observability

## Overview

This guide provides step-by-step instructions for Phase 4 (Week 4) of the Event Ticketing System V2 project. Each step includes detailed explanations, exact code to write, commands to run, and what to expect.

**Duration**: Week 4 (5-7 days)  
**Goal**: Set up automated CI/CD pipelines with GitHub Actions and build a full observability stack with CloudWatch dashboards, alarms, and X-Ray tracing.

**What Phase 3 gave us**:
- ✅ All 11 Lambda functions implemented and deployed
- ✅ HTTP API Gateway live at `https://u03i82lg6g.execute-api.us-east-1.amazonaws.com`
- ✅ Cognito JWT authorizer protecting all private routes
- ✅ SQS async ticket generation wired up
- ✅ Smoke test confirmed: `GET /v1/events` returns `{"events":[],"count":0}`

**What Phase 4 will give us**:
- GitHub Actions workflow that runs lint + tests + CDK synth on every PR
- Automated deployment to dev on every push to main
- Production deployment workflow with manual approval gate
- CloudWatch dashboard showing all key metrics in one view
- Alarms that email you when something goes wrong
- X-Ray service map showing request flow through the system
- Saved CloudWatch Logs Insights queries for debugging

---

## Important: What CI/CD Means and Why It Matters

Before we start, here's a plain-English explanation of what we're building.

**CI (Continuous Integration)**: Every time you push code, GitHub automatically runs your tests and checks. If anything fails, you know immediately — before it reaches AWS.

**CD (Continuous Deployment)**: Every time code merges to `main`, GitHub automatically deploys it to AWS. No more running `cdk deploy` manually.

**Why this matters for you**:
- You can't accidentally deploy broken code (tests must pass first)
- Every deployment is logged in GitHub — you can see exactly what changed and when
- If a deployment breaks something, you can roll back with one click
- You never have to remember to deploy — it happens automatically

**OIDC Authentication**: Instead of storing your AWS credentials as GitHub secrets (which is a security risk), we use OIDC (OpenID Connect). GitHub proves its identity to AWS directly, and AWS issues temporary credentials. No long-lived secrets stored anywhere.

---

## Part 1: GitHub Actions OIDC Setup (Day 22)

### Step 24.1: Understand OIDC Authentication

**What**: OIDC (OpenID Connect) lets GitHub Actions authenticate to AWS without storing AWS credentials as secrets.

**Why**: The traditional approach stores `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as GitHub secrets. These are long-lived credentials — if they leak, an attacker has permanent access. OIDC issues short-lived tokens (valid for 1 hour) that expire automatically.

**How it works**:
1. GitHub Actions starts a job
2. GitHub generates a signed JWT token proving "this is a workflow from repo X"
3. AWS verifies the JWT signature using GitHub's public key
4. AWS issues temporary credentials (valid 1 hour)
5. The workflow uses those credentials to deploy

**Expected Result**: GitHub Actions can deploy to AWS without any stored credentials

---

### Step 24.2: Add OIDC Provider to FoundationStack

**What**: Register GitHub as a trusted identity provider in your AWS account.

**Why**: AWS needs to know to trust JWTs signed by GitHub. The OIDC provider tells AWS "tokens from `token.actions.githubusercontent.com` are valid".

**How**: Open `lib/stacks/foundation-stack.ts` and add the OIDC provider and GitHub Actions role. Add these imports at the top:

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';
```

Then add this inside the constructor, after the existing KMS keys and WAF:

```typescript
// ==========================================
// GitHub Actions OIDC Provider
// ==========================================
// Allows GitHub Actions to authenticate to AWS without stored credentials
const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
  url: 'https://token.actions.githubusercontent.com',
  clientIds: ['sts.amazonaws.com'],
  // GitHub's OIDC thumbprint — this is a fixed value, not a secret
  thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
});

// ==========================================
// GitHub Actions IAM Role
// ==========================================
// This role is assumed by GitHub Actions workflows
this.githubActionsRole = new iam.Role(this, 'GitHubActionsRole', {
  roleName: `${props.projectName}-github-actions-${props.environment}`,
  description: 'Role assumed by GitHub Actions for CDK deployments',
  assumedBy: new iam.WebIdentityPrincipal(
    githubOidcProvider.openIdConnectProviderArn,
    {
      // Only allow workflows from YOUR repository
      'StringEquals': {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      },
      // Allow both main branch pushes and PRs from your repo
      'StringLike': {
        'token.actions.githubusercontent.com:sub':
          `repo:Anshuman-git-code/event-ticketing-v2:*`,
      },
    }
  ),
  maxSessionDuration: cdk.Duration.hours(1),
});

// Grant permissions needed for CDK deployments
// PowerUserAccess covers all CDK operations except IAM user management
this.githubActionsRole.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess')
);

// CDK also needs to pass roles to services (Lambda, API Gateway, etc.)
this.githubActionsRole.addToPolicy(new iam.PolicyStatement({
  actions: ['iam:PassRole', 'iam:CreateRole', 'iam:AttachRolePolicy',
            'iam:DetachRolePolicy', 'iam:DeleteRole', 'iam:PutRolePolicy',
            'iam:DeleteRolePolicy', 'iam:GetRole', 'iam:TagRole'],
  resources: [`arn:aws:iam::${this.account}:role/${props.projectName}-*`],
}));

// Output the role ARN — you'll need this for the GitHub workflow
new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
  value: this.githubActionsRole.roleArn,
  description: 'Copy this ARN into your GitHub Actions workflow',
  exportName: `${props.projectName}-${props.environment}-github-actions-role-arn`,
});
```

Also add `githubActionsRole` to the public properties at the top of the class:

```typescript
export class FoundationStack extends cdk.Stack {
  public readonly databaseEncryptionKey: kms.Key;
  public readonly storageEncryptionKey: kms.Key;
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly githubActionsRole: iam.Role;  // ← Add this line
```

**Expected Result**: TypeScript compiles without errors

---

### Step 24.3: Deploy Updated FoundationStack

**What**: Push the OIDC provider and GitHub Actions role to AWS.

**Why**: The role must exist in AWS before GitHub Actions can use it.

**How**: Run in your terminal:

```bash
npx cdk deploy event-ticketing-v2-foundation-dev --require-approval never
```

**Expected Result**:
```
✅  event-ticketing-v2-foundation-dev

Outputs:
event-ticketing-v2-foundation-dev.GitHubActionsRoleArn = arn:aws:iam::690081480550:role/event-ticketing-v2-github-actions-dev
```

**Copy the role ARN** — you'll need it in the next step.

---

### Step 24.4: Add Role ARN to GitHub Repository Secrets

**What**: Store the role ARN as a GitHub secret so workflows can reference it.

**Why**: The role ARN is not sensitive (it's just an identifier), but storing it as a secret keeps it configurable without changing workflow files.

**How**:
1. Go to `https://github.com/Anshuman-git-code/event-ticketing-v2`
2. Click **Settings** tab
3. Click **Secrets and variables** → **Actions** in the left sidebar
4. Click **New repository secret**
5. Name: `AWS_ROLE_ARN`
6. Value: paste the role ARN from the previous step (e.g., `arn:aws:iam::690081480550:role/event-ticketing-v2-github-actions-dev`)
7. Click **Add secret**

Also add:
- Name: `AWS_REGION`, Value: `us-east-1`
- Name: `AWS_ACCOUNT_ID`, Value: `690081480550`

**Expected Result**: Three secrets visible in GitHub repository settings

---

## Part 2: PR Validation Workflow (Day 23)

### Step 25.1: Understand What the PR Workflow Does

**What**: A GitHub Actions workflow that runs automatically on every Pull Request.

**Why**: Before any code merges to `main`, we want to verify:
- TypeScript compiles without errors
- ESLint finds no violations
- All unit tests pass
- CDK can synthesize the CloudFormation templates (no config errors)

If any of these fail, the PR is blocked from merging. This is your safety net.

**How it works**:
1. You create a branch, make changes, push to GitHub
2. You open a Pull Request to merge into `main`
3. GitHub automatically starts the workflow
4. You see green checkmarks (pass) or red X marks (fail) on the PR
5. You can only merge when all checks are green

---

### Step 25.2: Create the PR Validation Workflow File

**What**: Create the workflow YAML file that GitHub Actions reads.

**Why**: GitHub Actions looks for workflow files in `.github/workflows/`. Any `.yml` file there is automatically picked up.

**How**: Create the file `.github/workflows/pr-validation.yml`:

```yaml
name: PR Validation

# Trigger: runs on every pull request targeting the main branch
on:
  pull_request:
    branches: [main]

# Permissions needed for OIDC authentication
permissions:
  id-token: write   # Required for OIDC token generation
  contents: read    # Required to checkout the code

jobs:
  validate:
    name: Lint, Test, Build & Synth
    runs-on: ubuntu-latest

    steps:
      # Step 1: Download the code from GitHub
      - name: Checkout code
        uses: actions/checkout@v4

      # Step 2: Install Node.js 20 (matches our Lambda runtime)
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'  # Cache node_modules between runs (faster)

      # Step 3: Install dependencies (uses package-lock.json for reproducibility)
      - name: Install dependencies
        run: npm ci

      # Step 4: Run ESLint — catches code style and potential bugs
      - name: Run linter
        run: npm run lint

      # Step 5: Run Jest unit tests
      - name: Run tests
        run: npm test

      # Step 6: Compile TypeScript — catches type errors
      - name: Build TypeScript
        run: npm run build

      # Step 7: Authenticate to AWS using OIDC (no stored credentials!)
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}
          role-session-name: GitHubActions-PR-Validation

      # Step 8: CDK synth — verifies CloudFormation templates generate correctly
      # This catches CDK config errors without deploying anything
      - name: CDK Synth
        run: npx cdk synth --all --quiet
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}
```

**Expected Result**: File created at `.github/workflows/pr-validation.yml`

---

### Step 25.3: Test the PR Workflow

**What**: Verify the workflow actually runs by creating a test PR.

**Why**: Workflows only run when triggered — you need to confirm the file is correct.

**How**:
```bash
# Create a test branch
git checkout -b test/pr-workflow

# Make a trivial change (add a comment to any file)
echo "# Phase 4 CI/CD added" >> README.md

# Commit and push
git add .
git commit -m "test: verify PR validation workflow"
git push origin test/pr-workflow
```

Then go to GitHub and open a Pull Request from `test/pr-workflow` → `main`.

**Expected Result**:
- You see a "PR Validation" check appear on the PR
- After ~2-3 minutes, all steps show green checkmarks
- The PR shows "All checks have passed"

**If it fails**: Click on the failing step to see the error log. Common issues:
- `npm ci` fails → check `package-lock.json` is committed
- `cdk synth` fails → check for TypeScript errors in stack files

---

## Part 3: Dev Deployment Workflow (Day 24)

### Step 26.1: Understand the Dev Deployment Workflow

**What**: A workflow that automatically deploys to AWS every time code is merged to `main`.

**Why**: Manual deployments are error-prone. You might forget to deploy, deploy the wrong branch, or skip tests. Automated deployment ensures:
- Every merge to `main` is deployed
- Deployment only happens after tests pass
- Every deployment is logged with who merged what

**How it works**:
1. PR is approved and merged to `main`
2. GitHub automatically starts the deploy workflow
3. Tests run again (belt-and-suspenders)
4. `cdk deploy --all` runs with your AWS credentials
5. All stacks are updated if there are changes
6. You get a notification when deployment completes

---

### Step 26.2: Create the Dev Deployment Workflow

**What**: Create `.github/workflows/deploy-dev.yml`.

**How**:

```yaml
name: Deploy to Dev

# Trigger: runs on every push to main (i.e., after a PR is merged)
on:
  push:
    branches: [main]

# Permissions needed for OIDC
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    name: Deploy All Stacks to Dev
    runs-on: ubuntu-latest
    environment: dev  # Links to GitHub environment (for protection rules later)

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Run tests before deploying — never deploy broken code
      - name: Run tests
        run: npm test

      - name: Build TypeScript
        run: npm run build

      # Authenticate to AWS
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}
          role-session-name: GitHubActions-Deploy-Dev

      # Show what will change before deploying (logged for audit trail)
      - name: CDK Diff
        run: npx cdk diff --all
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}
        continue-on-error: true  # Diff failure shouldn't block deploy

      # Deploy all stacks
      - name: CDK Deploy
        run: npx cdk deploy --all --require-approval never --concurrency 3
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}

      # Print the API URL after deployment for easy reference
      - name: Print API URL
        run: |
          echo "✅ Deployment complete!"
          echo "API URL: https://u03i82lg6g.execute-api.us-east-1.amazonaws.com"
```

**What `--concurrency 3` does**: Deploys up to 3 independent stacks in parallel (e.g., Auth, Database, and Storage can all deploy at the same time since they don't depend on each other). This cuts deployment time roughly in half.

**Expected Result**: File created at `.github/workflows/deploy-dev.yml`

---

### Step 26.3: Create the Dev Environment in GitHub

**What**: GitHub "Environments" let you add protection rules and track deployments.

**Why**: With an environment configured, you can see deployment history in GitHub and add approval requirements later.

**How**:
1. Go to your GitHub repo → **Settings** → **Environments**
2. Click **New environment**
3. Name: `dev`
4. Click **Configure environment**
5. Leave all settings as default for now (no protection rules on dev)
6. Click **Save protection rules**

**Expected Result**: `dev` environment appears in GitHub settings

---

### Step 26.4: Test the Dev Deployment Workflow

**What**: Merge the test PR from Step 25.3 to trigger the first automated deployment.

**How**:
1. Go to the PR you created in Step 25.3
2. Click **Merge pull request** → **Confirm merge**
3. Go to the **Actions** tab in your GitHub repo
4. You should see "Deploy to Dev" workflow starting

**Expected Result**:
- Workflow runs for ~3-4 minutes
- All steps show green checkmarks
- CDK Diff shows the changes from your test commit
- CDK Deploy completes successfully

**What to look for in the logs**:
```
✅  event-ticketing-v2-foundation-dev (no changes)
✅  event-ticketing-v2-auth-dev (no changes)
...
✅  Deployment complete!
```

---

## Part 4: Production Deployment Workflow (Day 25)

### Step 27.1: Understand the Prod Workflow

**What**: A separate workflow for deploying to production, triggered by a version tag and requiring manual approval.

**Why**: You never want production to deploy automatically. The prod workflow adds:
- **Tag-based trigger**: Only deploys when you create a release tag like `v1.0.0`
- **Manual approval gate**: A human must click "Approve" before deployment proceeds
- **Required reviewers**: Only specific people can approve prod deployments

**How it works**:
1. You decide the code is ready for production
2. You create a Git tag: `git tag v1.0.0 && git push origin v1.0.0`
3. GitHub starts the prod workflow
4. Workflow pauses and sends you an email: "Deployment to prod is waiting for approval"
5. You review the changes and click "Approve"
6. Deployment proceeds to production

---

### Step 27.2: Create the Prod Environment in GitHub

**What**: Create a `prod` environment with required reviewers.

**How**:
1. Go to GitHub repo → **Settings** → **Environments**
2. Click **New environment**
3. Name: `prod`
4. Click **Configure environment**
5. Under **Required reviewers**, click the text box and add your GitHub username
6. Check **Prevent self-review** — OFF (you're a solo developer, you need to approve your own deployments)
7. Under **Deployment branches**, select **Selected branches** → Add rule → `main`
8. Click **Save protection rules**

**Expected Result**: `prod` environment requires your approval before any deployment

---

### Step 27.3: Add Prod Secrets

**What**: Add a separate role ARN for production deployments.

**Why**: In a real project, prod would have a separate AWS account with stricter permissions. For now, we'll use the same account but a separate role.

**How**: For this project, you can reuse the same `AWS_ROLE_ARN` secret. In a real production setup you would:
1. Create a separate `prod` AWS account
2. Create a separate OIDC provider and role in that account
3. Add `AWS_ROLE_ARN_PROD` as a separate secret

For now, add these environment-level secrets to the `prod` environment:
1. Go to **Settings** → **Environments** → **prod**
2. Under **Environment secrets**, add:
   - `AWS_ROLE_ARN`: same value as the repo-level secret
   - `AWS_REGION`: `us-east-1`
   - `AWS_ACCOUNT_ID`: `690081480550`

---

### Step 27.4: Create the Prod Deployment Workflow

**What**: Create `.github/workflows/deploy-prod.yml`.

**How**:

```yaml
name: Deploy to Production

# Trigger: only on version tags like v1.0.0, v1.2.3, etc.
on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  id-token: write
  contents: read

jobs:
  deploy-prod:
    name: Deploy All Stacks to Production
    runs-on: ubuntu-latest
    environment: prod  # This triggers the manual approval gate

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build TypeScript
        run: npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}
          role-session-name: GitHubActions-Deploy-Prod

      # Show exactly what will change in production
      - name: CDK Diff (Production)
        run: npx cdk diff --all --context environment=prod
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}
        continue-on-error: true

      # Deploy to production
      - name: CDK Deploy (Production)
        run: npx cdk deploy --all --require-approval never --context environment=prod
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}

      - name: Deployment Summary
        run: |
          echo "🚀 Production deployment complete!"
          echo "Tag: ${{ github.ref_name }}"
          echo "Deployed by: ${{ github.actor }}"
          echo "Timestamp: $(date -u)"
```

**Expected Result**: File created at `.github/workflows/deploy-prod.yml`

---

### Step 27.5: Test the Prod Workflow

**What**: Create a test release tag to verify the workflow triggers and pauses for approval.

**How**:
```bash
# Make sure you're on main and up to date
git checkout main
git pull origin main

# Create a version tag
git tag v0.1.0
git push origin v0.1.0
```

**Expected Result**:
1. Go to GitHub → **Actions** tab
2. You see "Deploy to Production" workflow started
3. It pauses at the `deploy-prod` job with a yellow "Waiting" status
4. You receive an email: "Your review is required"
5. Click **Review deployments** → select `prod` → click **Approve and deploy**
6. Deployment proceeds and completes

---

## Part 5: ObservabilityStack Implementation (Day 26)

### Step 28.1: Understand What We Are Building

**What**: A CloudWatch dashboard that shows all key metrics for your system in one place, plus alarms that notify you when something goes wrong.

**Why**: Right now, if your API starts returning errors or slowing down, you have no idea until a user complains. Observability means:
- **Dashboard**: One screen showing API health, Lambda performance, DynamoDB load, SQS queue depth
- **Alarms**: Automatic email when error rate spikes, latency increases, or the DLQ gets messages
- **X-Ray**: Visual map of every request flowing through your system

**What each metric tells you**:
- `5xx errors` → Your Lambda is crashing
- `4xx errors` → Clients are sending bad requests (or auth is broken)
- `p99 latency` → 99% of requests complete within this time (your worst-case experience)
- `Lambda duration` → How long each function takes (close to timeout = danger)
- `DLQ message count` → Ticket generation is failing (messages stuck in dead letter queue)
- `DynamoDB throttled requests` → You're hitting DynamoDB capacity limits

---

### Step 28.2: Implement ObservabilityStack

**What**: Replace the skeleton `lib/stacks/observability-stack.ts` with the full implementation.

**Why**: The skeleton has no resources. We need to add the dashboard, alarms, and SNS topic.

**How**: Replace the contents of `lib/stacks/observability-stack.ts` with:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  // Your email address for alarm notifications
  alarmEmail?: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ==========================================
    // SNS Topic for alarm notifications
    // ==========================================
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${props.projectName}-alarms-${props.environment}`,
      displayName: 'Event Ticketing Alarms',
    });

    // Subscribe your email to receive alarm notifications
    if (props.alarmEmail) {
      this.alarmTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.alarmEmail)
      );
    }

    // ==========================================
    // Helper: create a standard alarm
    // ==========================================
    const createAlarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
      comparisonOperator = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    ) => {
      const alarm = new cloudwatch.Alarm(this, id, {
        alarmName: `${props.projectName}-${props.environment}-${id}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 2,        // Must breach for 2 consecutive periods
        datapointsToAlarm: 2,        // Both periods must breach
        comparisonOperator,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
      alarm.addOkAction(new cloudwatchActions.SnsAction(this.alarmTopic));
      return alarm;
    };

    // ==========================================
    // API Gateway Metrics
    // ==========================================
    const apiId = cdk.Fn.importValue(
      `${props.projectName}-${props.environment}-api-id`
    );

    const api5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiLatencyP99 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: { ApiId: apiId },
      statistic: 'p99',
      period: cdk.Duration.minutes(5),
    });

    const apiCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // Lambda Metrics (per function)
    // ==========================================
    const lambdaFunctions = [
      'CreateEventFn', 'ListEventsFn', 'GetEventFn', 'UpdateEventFn',
      'DeleteEventFn', 'CreateRegistrationFn', 'GetMyRegistrationsFn',
      'GetEventRegistrationsFn', 'GenerateTicketFn', 'GetTicketDownloadFn',
      'ValidateTicketFn',
    ];

    const lambdaErrorMetrics = lambdaFunctions.map(fn =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: `${props.projectName}-${fn}-${props.environment}` },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      })
    );

    const lambdaDurationMetrics = lambdaFunctions.map(fn =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: { FunctionName: `${props.projectName}-${fn}-${props.environment}` },
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      })
    );

    // ==========================================
    // SQS Metrics
    // ==========================================
    const sqsQueueName = `${props.projectName}-ticket-generation-${props.environment}.fifo`;
    const sqsDlqName = `${props.projectName}-ticket-generation-dlq-${props.environment}.fifo`;

    const sqsQueueDepth = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: { QueueName: sqsQueueName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    const sqsDlqDepth = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: { QueueName: sqsDlqName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // DynamoDB Metrics
    // ==========================================
    const dynamoThrottledReads = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ReadThrottleEvents',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const dynamoThrottledWrites = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'WriteThrottleEvents',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // Alarms
    // ==========================================
    createAlarm('Api5xxAlarm', api5xxMetric, 5,
      'API Gateway 5xx errors exceeded 5 in 5 minutes — Lambda may be crashing');

    createAlarm('ApiLatencyAlarm', apiLatencyP99, 1000,
      'API Gateway p99 latency exceeded 1 second — investigate slow Lambdas');

    createAlarm('SqsDlqAlarm', sqsDlqDepth, 1,
      'Messages in ticket generation DLQ — ticket generation is failing');

    createAlarm('DynamoThrottleAlarm',
      new cloudwatch.MathExpression({
        expression: 'reads + writes',
        usingMetrics: { reads: dynamoThrottledReads, writes: dynamoThrottledWrites },
        period: cdk.Duration.minutes(5),
      }),
      1,
      'DynamoDB throttling detected — consider increasing capacity or adding caching'
    );

    // ==========================================
    // CloudWatch Dashboard
    // ==========================================
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${props.projectName}-${props.environment}`,
    });

    this.dashboard.addWidgets(
      // Row 1: API Gateway overview
      new cloudwatch.TextWidget({
        markdown: '## API Gateway',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Request Count',
        left: [apiCountMetric],
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: '5xx Errors',
        left: [api5xxMetric],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: '4xx Errors',
        left: [api4xxMetric],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Latency p99 (ms)',
        left: [apiLatencyP99],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      })
    );

    this.dashboard.addWidgets(
      // Row 2: Lambda overview
      new cloudwatch.TextWidget({
        markdown: '## Lambda Functions',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors (all functions)',
        left: lambdaErrorMetrics,
        leftYAxis: { min: 0 },
        width: 12, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration p95 (ms)',
        left: lambdaDurationMetrics,
        leftYAxis: { min: 0 },
        width: 12, height: 6,
      })
    );

    this.dashboard.addWidgets(
      // Row 3: SQS and DynamoDB
      new cloudwatch.TextWidget({
        markdown: '## SQS Queue & DynamoDB',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Ticket Queue Depth',
        left: [sqsQueueDepth],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DLQ Depth (should be 0)',
        left: [sqsDlqDepth],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Reads',
        left: [dynamoThrottledReads],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Writes',
        left: [dynamoThrottledWrites],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      })
    );

    // Alarm status widget — shows all alarms at a glance
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## Alarm Status',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'All Alarms',
        alarms: [
          // Alarms are referenced by their construct IDs
        ],
        width: 24, height: 4,
      })
    );

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${props.projectName}-${props.environment}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS Topic ARN for alarm notifications',
    });
  }
}
```

**Expected Result**: TypeScript compiles without errors

---

### Step 28.3: Wire ObservabilityStack into bin/event-ticketing-v2.ts

**What**: Pass your email address to the ObservabilityStack so alarms can notify you.

**Why**: The stack needs your email to create the SNS subscription. Without it, alarms fire silently.

**How**: Open `bin/event-ticketing-v2.ts` and update the ObservabilityStack instantiation:

```typescript
const observabilityStack = new ObservabilityStack(
  app,
  `${projectName}-observability-${environment}`,
  {
    ...commonProps,
    alarmEmail: 'your-email@example.com',  // ← Replace with your actual email
  }
);
```

**Expected Result**: Stack compiles and `cdk synth` shows the SNS subscription resource

---

### Step 28.4: Deploy ObservabilityStack

**What**: Deploy the dashboard and alarms to AWS.

**Why**: Resources only exist in AWS after deployment.

**How**:
```bash
npx cdk deploy event-ticketing-v2-observability-dev --require-approval never
```

**Expected Result**:
```
✅  event-ticketing-v2-observability-dev

Outputs:
event-ticketing-v2-observability-dev.DashboardUrl = https://us-east-1.console.aws.amazon.com/cloudwatch/home#dashboards:name=event-ticketing-v2-dev
event-ticketing-v2-observability-dev.AlarmTopicArn = arn:aws:sns:us-east-1:690081480550:event-ticketing-v2-alarms-dev
```

**Important**: Check your email inbox. You'll receive a message from AWS SNS:
> "You have chosen to subscribe to the topic: event-ticketing-v2-alarms-dev"

Click **Confirm subscription** in that email. If you don't confirm, you won't receive alarm notifications.

---

### Step 28.5: Verify the Dashboard

**What**: Open the CloudWatch dashboard and confirm it's showing data.

**How**:
1. Click the `DashboardUrl` from the deployment output
2. Or go to AWS Console → CloudWatch → Dashboards → `event-ticketing-v2-dev`

**What you'll see**:
- API Gateway graphs will show data if you've made any requests
- Lambda graphs will show data from the smoke test earlier
- SQS and DynamoDB graphs will be flat (no load yet)

**Run a few test requests to generate data**:
```bash
# Generate some API traffic
for i in {1..5}; do
  curl https://u03i82lg6g.execute-api.us-east-1.amazonaws.com/v1/events
done
```

Wait 2-3 minutes, then refresh the dashboard. You should see the request count graph update.

**Expected Result**: Dashboard shows live metrics from your API

---

## Part 6: X-Ray Configuration (Day 27)

### Step 30.1: Understand X-Ray

**What**: AWS X-Ray traces requests as they flow through your system — from API Gateway → Lambda → DynamoDB.

**Why**: When a request is slow or fails, X-Ray shows you exactly where the time was spent. Instead of guessing "is it the Lambda or DynamoDB?", you see a timeline showing each step.

**How it works**:
- Every Lambda function already has `tracing: lambda.Tracing.ACTIVE` set (we did this in Phase 3)
- Lambda Powertools Tracer automatically creates X-Ray segments for DynamoDB and S3 calls
- X-Ray stitches all segments together into a "trace" showing the full request path

**What you'll see in X-Ray**:
```
API Gateway (5ms)
  └── CreateEventFn Lambda (45ms)
        ├── DynamoDB PutItem (12ms)
        └── Response (2ms)
```

---

### Step 30.2: Verify X-Ray is Enabled

**What**: Confirm X-Ray tracing is active on all Lambda functions.

**Why**: X-Ray must be enabled at the Lambda level AND the code must use the Tracer. Both are already done — this step just verifies.

**How**: Check in AWS Console:
1. Go to AWS Console → Lambda
2. Click on `event-ticketing-v2-CreateEventFn-dev` (or any function)
3. Click **Configuration** tab → **Monitoring and operations tools**
4. Verify **AWS X-Ray** shows "Active tracing"

Or verify via CLI:
```bash
aws lambda get-function-configuration \
  --function-name event-ticketing-v2-CreateEventFn-dev \
  --query 'TracingConfig'
```

**Expected Result**: `{"Mode": "Active"}`

---

### Step 30.3: View X-Ray Service Map

**What**: See the visual map of your system's request flow.

**How**:
1. Make a few API requests to generate traces:
```bash
curl https://u03i82lg6g.execute-api.us-east-1.amazonaws.com/v1/events
curl https://u03i82lg6g.execute-api.us-east-1.amazonaws.com/v1/events/nonexistent-id
```

2. Go to AWS Console → **X-Ray** → **Service map**
3. Set time range to "Last 5 minutes"

**Expected Result**: You see a graph with nodes:
- `client` → `API Gateway` → `Lambda function` → `DynamoDB`

Each edge shows request count and average latency. Red edges indicate errors.

---

### Step 30.4: Configure X-Ray Sampling Rules

**What**: Control what percentage of requests X-Ray traces.

**Why**: By default, X-Ray samples 5% of requests (to control cost). For a dev environment with low traffic, we want 100% sampling so we can see every request.

**How**: Go to AWS Console → X-Ray → **Sampling rules** → **Create sampling rule**:

```
Rule name: event-ticketing-dev-all
Priority: 1
Reservoir size: 5
Fixed rate: 100%
Service name: *
Service type: AWS::Lambda::Function
HTTP method: *
URL path: *
Resource ARN: *
```

**Expected Result**: All Lambda invocations are traced in X-Ray

**Cost note**: At low traffic (< 100k requests/month), X-Ray is free. At higher traffic, reduce sampling to 10-20%.

---

## Part 7: CloudWatch Logs Insights Queries (Day 28)

### Step 31.1: Understand Logs Insights

**What**: CloudWatch Logs Insights lets you run SQL-like queries against your Lambda log groups to find errors, slow requests, and patterns.

**Why**: Lambda Powertools writes structured JSON logs. Logs Insights can query those JSON fields directly — much faster than scrolling through raw logs.

**Example**: Instead of reading thousands of log lines to find errors, you run:
```sql
fields @timestamp, level, message, error
| filter level = "ERROR"
| sort @timestamp desc
| limit 20
```

And get a table of all errors in the last hour.

---

### Step 31.2: Create Saved Queries

**What**: Save useful queries so you can run them with one click.

**How**: Go to AWS Console → CloudWatch → **Logs Insights** → **Queries** → **Create query(At the top right of the Logs Insights page, look for a "Save" button — but you need to run a query first before you can save it)**

**Query 1: All errors in the last hour**
- Query name: `All Lambda Errors`
- Log groups: Select all `/aws/lambda/event-ticketing-v2-*` groups
- Query:
```sql
fields @timestamp, service, level, message, error.message, xray_trace_id
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

**Query 2: Slow requests (over 1 second)**
- Query name: `Slow Requests`
- Log groups: Select all Lambda groups
- Query:
```sql
fields @timestamp, service, message, @duration
| filter @type = "REPORT"
| filter @duration > 1000
| sort @duration desc
| limit 20
```

**Query 3: Failed registrations**
- Query name: `Failed Registrations`
- Log group: `/aws/lambda/event-ticketing-v2-CreateRegistrationFn-dev`
- Query:
```sql
fields @timestamp, message, eventId, userId, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 20
```

**Query 4: Ticket generation failures**
- Query name: `Ticket Generation Failures`
- Log group: `/aws/lambda/event-ticketing-v2-GenerateTicketFn-dev`
- Query:
```sql
fields @timestamp, message, registrationId, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 20
```

**Query 5: Request volume by endpoint (last 24 hours)**
- Query name: `Request Volume by Service`
- Log groups: Select all Lambda groups
- Query:
```sql
fields service
| filter @type = "REPORT"
| stats count() as invocations, avg(@duration) as avgDuration, max(@duration) as maxDuration by service
| sort invocations desc
```

**Expected Result**: 5 saved queries visible in CloudWatch Logs Insights

---

### Step 31.3: How to Use Logs Insights for Debugging

**Scenario**: A user reports their ticket wasn't generated.

**Steps**:
1. Go to CloudWatch → Logs Insights
2. Select the "Ticket Generation Failures" saved query
3. Set time range to when the user registered
4. Click **Run query**
5. Find the error row with their `registrationId`
6. Copy the `xray_trace_id`
7. Go to X-Ray → **Traces** → paste the trace ID
8. See exactly where the failure occurred (DynamoDB? S3? PDF generation?)

This workflow turns a 30-minute debugging session into a 2-minute one.

---

## Part 8: Commit and Deploy Everything (Day 28)

### Step 32.1: Commit All Phase 4 Changes

**What**: Commit the new workflow files and updated stack to GitHub.

**How**:
```bash
# Stage all new and modified files
git add .github/workflows/pr-validation.yml
git add .github/workflows/deploy-dev.yml
git add .github/workflows/deploy-prod.yml
git add lib/stacks/foundation-stack.ts
git add lib/stacks/observability-stack.ts
git add bin/event-ticketing-v2.ts

# Commit
git commit -m "feat(phase4): add CI/CD pipelines and observability stack

- Add GitHub Actions PR validation workflow (lint, test, build, synth)
- Add GitHub Actions dev deployment workflow (auto-deploy on merge to main)
- Add GitHub Actions prod deployment workflow (tag-triggered with approval gate)
- Add OIDC provider and GitHubActionsRole to FoundationStack
- Implement ObservabilityStack with CloudWatch dashboard and alarms
- Add SNS alarm topic with email notifications
- Dashboard covers: API Gateway, Lambda, SQS, DynamoDB metrics
- Alarms: 5xx errors, p99 latency, DLQ depth, DynamoDB throttling"

# Push to GitHub
git push origin main
```

**Expected Result**: Push triggers the dev deployment workflow automatically. Watch it run in GitHub → Actions tab.

---

### Step 32.2: Verify Full Phase 4 Deployment

**What**: Confirm everything is working end-to-end.

**Checklist**:

```
GitHub Actions
  ✅ PR validation workflow file exists at .github/workflows/pr-validation.yml
  ✅ Dev deployment workflow file exists at .github/workflows/deploy-dev.yml
  ✅ Prod deployment workflow file exists at .github/workflows/deploy-prod.yml
  ✅ AWS_ROLE_ARN, AWS_REGION, AWS_ACCOUNT_ID secrets set in GitHub
  ✅ dev and prod environments created in GitHub settings

AWS Resources
  ✅ OIDC provider created in IAM
  ✅ GitHubActionsRole created with PowerUserAccess
  ✅ ObservabilityStack deployed successfully
  ✅ CloudWatch dashboard visible at the DashboardUrl output
  ✅ 4 alarms created in CloudWatch Alarms
  ✅ SNS subscription confirmed via email

Observability
  ✅ Dashboard shows API Gateway metrics
  ✅ X-Ray service map shows request flow
  ✅ 5 saved Logs Insights queries created
```

---

## Phase 4 Complete — What You Now Have

At the end of Phase 4, your system has:

**Automated CI/CD**:
- Every PR automatically runs lint, tests, TypeScript build, and CDK synth
- Every merge to `main` automatically deploys to dev
- Production deployments require a version tag + manual approval

**Full Observability**:
- CloudWatch dashboard showing API health, Lambda performance, SQS depth, DynamoDB load
- Email alerts when error rate spikes, latency increases, or ticket generation fails
- X-Ray traces showing exactly where time is spent in every request
- Saved Logs Insights queries for fast debugging

**What's next — Phase 5**:
- React + Vite frontend
- AWS Amplify integration with Cognito
- CloudFront distribution for global delivery
- Organizer portal (create events, view registrations, validate tickets)
- Attendee portal (browse events, register, download tickets)

---

## Troubleshooting

### GitHub Actions fails with "credentials could not be assumed"

**Cause**: The OIDC trust policy doesn't match your repository name.

**Fix**: Check the `StringLike` condition in the GitHubActionsRole trust policy. It must exactly match `repo:YOUR_GITHUB_USERNAME/event-ticketing-v2:*`. Update `foundation-stack.ts` and redeploy.

---

### CDK synth fails in GitHub Actions but works locally

**Cause**: The workflow is missing environment variables that CDK needs.

**Fix**: Make sure the CDK Deploy step has:
```yaml
env:
  CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
  CDK_DEFAULT_REGION: ${{ secrets.AWS_REGION }}
```

---

### ObservabilityStack fails with "Export not found"

**Cause**: The stack tries to import the API ID via `Fn.importValue`, but the ApiStack hasn't been deployed yet (or the export name doesn't match).

**Fix**: Deploy the ApiStack first, then deploy ObservabilityStack. The export name must match exactly: `event-ticketing-v2-dev-api-id`.

---

### SNS subscription confirmation email never arrived

**Fix**: Check your spam folder. The email comes from `no-reply@sns.amazonaws.com`. If it's not there, go to AWS Console → SNS → Topics → click your topic → **Subscriptions** → check the status. If it shows "PendingConfirmation", click **Request confirmation** to resend.

---

### Alarm fires immediately after deployment

**Cause**: CloudWatch alarms evaluate immediately on creation. If there's no data yet, some alarms may briefly enter ALARM state.

**Fix**: This is normal. Alarms with `treatMissingData: NOT_BREACHING` will return to OK state once data starts flowing. Wait 10 minutes after deployment.

---

### X-Ray shows no traces

**Cause**: X-Ray data takes 1-2 minutes to appear. Also, the default sampling rate may be filtering out requests.

**Fix**: Make a few API requests, wait 2 minutes, then check X-Ray. If still empty, verify the Lambda function has `TracingConfig.Mode = Active` (see Step 30.2).
