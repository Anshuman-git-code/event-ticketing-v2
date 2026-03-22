# Phase 1 Implementation Guide: Foundation Setup

## Overview

This guide provides step-by-step instructions for Phase 1 (Week 1) of the Event Ticketing System V2 project. Each step includes detailed explanations, commands, and what to expect.

**Duration**: Week 1 (5-7 days)  
**Goal**: Set up AWS account security, initialize CDK project, and create foundational infrastructure code

---

## Part 1: AWS Account Hardening (Day 1)

### Step 1.1: Create or Verify AWS Account

**What**: Ensure you have an AWS account ready for the project.

**Why**: You need an AWS account to deploy resources. Using a dedicated account for this project helps with cost tracking and security isolation.

**How**:
1. If you don't have an account: Go to https://aws.amazon.com and click "Create an AWS Account"
2. If you have an account: Sign in to https://console.aws.amazon.com
3. Note your AWS Account ID (12-digit number visible in top-right corner)

**Expected Result**: You can access the AWS Management Console

---

### Step 1.2: Enable MFA on Root Account

**What**: Multi-Factor Authentication adds a second layer of security to your root account.

**Why**: Root account has unlimited access to everything. MFA prevents unauthorized access even if password is compromised.

**How**:
1. Sign in as root user (use email address you registered with)
2. Click your account name (top-right) → "Security credentials"
3. Scroll to "Multi-factor authentication (MFA)" section
4. Click "Assign MFA device"
5. Choose "Authenticator app" (recommended: Google Authenticator, Authy, or Microsoft Authenticator)
6. Scan QR code with your phone app
7. Enter two consecutive MFA codes to verify
8. Click "Add MFA"

**Expected Result**: You see "MFA device successfully associated" and your root account shows MFA enabled

**Important**: After this, NEVER use root account for daily work. We'll create an admin user next.

---

### Step 1.3: Create IAM Identity Center Admin User

**What**: IAM Identity Center (formerly AWS SSO) provides a secure way to manage user access without using root.

**Why**: Following AWS best practices - root account should only be used for account-level tasks, not daily operations.

**How**:
1. In AWS Console, search for "IAM Identity Center" in the search bar
2. Click "Enable" if not already enabled
3. Choose "Enable with AWS Organizations" (it will create an organization automatically)
4. Once enabled, click "Users" in left sidebar
5. Click "Add user"
6. Fill in details:
   - Username: `admin` (or your preferred name)
   - Email: Your email address
   - First name / Last name: Your name
7. Click "Next"
8. On "Add user to groups" page, click "Create group"
9. Group name: `Administrators`
10. Select permission set: `AdministratorAccess`
11. Click "Create group"
12. Select the new group and click "Next"
13. Review and click "Add user"
14. Check your email for the invitation link
15. Click the link and set your password

**Expected Result**: You can sign in to AWS using the IAM Identity Center portal URL (looks like: `https://d-xxxxxxxxxx.awsapps.com/start`)

**From now on**: Use this admin user, NOT the root account!

---

### Step 1.4: Enable AWS Config

**What**: AWS Config tracks configuration changes to your AWS resources.

**Why**: Provides audit trail of all resource changes, helps with compliance, and enables security monitoring.

**How**:
1. Sign in with your IAM Identity Center admin user
2. Ensure you're in `us-east-1` region (check top-right corner, change if needed)
3. Search for "Config" in the search bar
4. Click "Get started" (if first time) or "Settings"
5. Choose "Record all resources supported in this region"
6. Create new S3 bucket for Config: `config-bucket-{your-account-id}`
7. Create new SNS topic: `config-topic`
8. Leave IAM role as "Create AWS Config service-linked role"
9. Click "Next" and "Confirm"

**Expected Result**: AWS Config dashboard shows "Recording" status

**Cost**: ~$2-3/month for this project

---

### Step 1.5: Enable CloudTrail Organization Trail

**What**: CloudTrail logs every API call made in your AWS account.

**Why**: Essential for security auditing, troubleshooting, and compliance. Records WHO did WHAT and WHEN.

**How**:
1. Search for "CloudTrail" in AWS Console
2. Click "Create trail"
3. Trail name: `event-ticketing-org-trail`
4. Enable "Enable for all accounts in my organization" (even though you have one account, this is best practice)
5. Storage location: Create new S3 bucket: `cloudtrail-logs-{your-account-id}`
6. Log file SSE-KMS encryption: Enabled (use default key)
7. Log file validation: Enabled
8. SNS notification delivery: Disabled (optional, can enable later)
9. CloudWatch Logs: Disabled for now (we'll add monitoring later)
10. Click "Next"
11. Event type: Choose "Management events" and "Data events" (optional)
12. Click "Next" and "Create trail"

**Expected Result**: Trail shows "Logging" status

**Cost**: ~$2-3/month

---

### Step 1.6: Enable GuardDuty

**What**: GuardDuty is AWS's threat detection service that monitors for malicious activity.

**Why**: Automatically detects compromised credentials, unusual API calls, cryptocurrency mining, and other threats.

**How**:
1. Search for "GuardDuty" in AWS Console
2. Click "Get Started"
3. Click "Enable GuardDuty"
4. That's it! GuardDuty starts monitoring immediately

**Expected Result**: GuardDuty dashboard shows "Protection enabled"

**Cost**: ~$5-10/month (30-day free trial available)

**What it monitors**:
- CloudTrail logs for unusual API activity
- VPC Flow Logs for network anomalies
- DNS logs for malicious domains

---


### Step 1.7: Enable Security Hub

**What**: Security Hub aggregates security findings from GuardDuty, Config, and other AWS services into one dashboard.

**Why**: Provides a unified view of your security posture and compliance status.

**How**:
1. Search for "Security Hub" in AWS Console
2. Click "Go to Security Hub"
3. Click "Enable Security Hub"
4. Choose security standards to enable:
   - ✅ AWS Foundational Security Best Practices
   - ✅ CIS AWS Foundations Benchmark
5. Click "Enable Security Hub"

**Expected Result**: Security Hub dashboard shows enabled standards and starts running checks

**Cost**: ~$0.001 per check (very low for this project)

**What you'll see**: Security Hub will show findings like "S3 bucket should have encryption enabled" - these are helpful reminders to follow best practices.

---

### Step 1.8: Set AWS Budget Alert

**What**: Budget alerts notify you when spending exceeds thresholds.

**Why**: Prevents surprise bills. You'll get email alerts if costs approach your limit.

**How**:
1. Search for "Billing" or "AWS Budgets" in AWS Console
2. Click "Budgets" in left sidebar
3. Click "Create budget"
4. Choose "Customize (advanced)"
5. Budget type: "Cost budget"
6. Click "Next"
7. Budget name: `event-ticketing-v2-monthly-budget`
8. Period: Monthly
9. Budget effective dates: Recurring budget
10. Budgeted amount: `$25.00`
11. Click "Next"
12. Add alert threshold:
    - Threshold: `80%` (alert at $20)
    - Email recipients: Your email address
13. Add second alert:
    - Threshold: `100%` (alert at $25)
    - Email recipients: Your email address
14. Click "Next", review, and "Create budget"

**Expected Result**: You receive a confirmation email. You'll get alerts when spending reaches $20 and $25.

**Cost**: First 2 budgets are free!

---

### Step 1.9: Enable Cost Explorer and Tags

**What**: Cost Explorer visualizes your AWS spending. Cost allocation tags help track costs by project/environment.

**Why**: Understand where money is going and optimize spending.

**How**:

**Enable Cost Explorer**:
1. Go to Billing Dashboard
2. Click "Cost Explorer" in left sidebar
3. Click "Enable Cost Explorer"
4. Wait 24 hours for data to populate

**Create Tag Policy**:
1. Search for "Resource Groups & Tag Editor"
2. Click "Tag policies" in left sidebar
3. Click "Create tag policy"
4. Policy name: `event-ticketing-tags`
5. Add required tags:
   ```json
   {
     "tags": {
       "Environment": {
         "tag_key": {
           "@@assign": "Environment"
         },
         "tag_value": {
           "@@assign": ["dev", "staging", "prod"]
         }
       },
       "Project": {
         "tag_key": {
           "@@assign": "Project"
         },
         "tag_value": {
           "@@assign": ["event-ticketing-v2"]
         }
       }
     }
   }
   ```
6. Click "Create policy"

**Expected Result**: All resources you create will be tagged with Environment and Project for cost tracking.

---

## Part 2: Repository and CDK Setup (Day 2)

### Step 2.1: Create GitHub Repository

**What**: Create a Git repository to store your code.

**Why**: Version control is essential for tracking changes, collaboration, and CI/CD.

**How**:
1. Go to https://github.com
2. Click "+" icon (top-right) → "New repository"
3. Repository name: `event-ticketing-v2`
4. Description: "Production-grade serverless event ticketing platform on AWS"
5. Visibility: Private (recommended) or Public
6. ✅ Add a README file
7. Add .gitignore: Choose "Node"
8. License: MIT (or your preference)
9. Click "Create repository"

**Expected Result**: You have a new GitHub repository

---

### Step 2.2: Enable Branch Protection

**What**: Branch protection prevents direct pushes to main branch, requiring pull requests.

**Why**: Ensures all code is reviewed and tested before merging.

**How**:
1. In your GitHub repo, click "Settings" tab
2. Click "Branches" in left sidebar
3. Click "Add branch protection rule"
4. Branch name pattern: `main`
5. Enable these settings:
   - ✅ Require a pull request before merging
   - ✅ Require approvals: 1 (you can approve your own PRs for solo projects)
   - ✅ Require status checks to pass before merging (we'll add CI later)
   - ✅ Require conversation resolution before merging
6. Click "Create"

**Expected Result**: You cannot push directly to main - must create branches and PRs

---

### Step 2.3: Clone Repository and Install AWS CDK

**What**: Download the repo to your computer and install AWS CDK CLI.

**Why**: You need the code locally to work on it, and CDK CLI to deploy infrastructure.

**Prerequisites**: 
- Node.js 18+ installed (check: `node --version`)
- npm installed (check: `npm --version`)
- Git installed (check: `git --version`)

**How**:
```bash
# Clone your repository
git clone https://github.com/YOUR_USERNAME/event-ticketing-v2.git
cd event-ticketing-v2

# Install AWS CDK globally
npm install -g aws-cdk

# Verify installation
cdk --version
# Should show: 2.x.x or higher
```

**Expected Result**: `cdk --version` shows version 2.x.x

**Troubleshooting**:
- If `npm install -g` fails with permission errors on Mac/Linux: Use `sudo npm install -g aws-cdk`
- If Node.js not installed: Download from https://nodejs.org (LTS version)

---

### Step 2.4: Initialize CDK Project

**What**: Create the CDK project structure with TypeScript.

**Why**: CDK provides the framework for defining infrastructure as code.

**How**:
```bash
# Make sure you're in the project directory
cd event-ticketing-v2

# Initialize CDK app
cdk init app --language typescript

# This creates:
# - bin/event-ticketing-v2.ts (entry point)
# - lib/event-ticketing-v2-stack.ts (sample stack)
# - package.json (dependencies)
# - tsconfig.json (TypeScript config)
# - cdk.json (CDK config)
```

**Expected Result**: You see "✅ All done!" message and new files created

**What just happened**:
- CDK created a TypeScript project structure
- Installed AWS CDK libraries
- Created a sample stack (we'll replace this)

---

### Step 2.5: Bootstrap CDK

**What**: Bootstrap prepares your AWS account for CDK deployments by creating necessary resources.

**Why**: CDK needs an S3 bucket to store templates and IAM roles to deploy resources.

**Prerequisites**: Configure AWS credentials first!

**Configure AWS Credentials**:
```bash
# Install AWS CLI if not already installed
# Mac: brew install awscli
# Windows: Download from https://aws.amazon.com/cli/
# Linux: sudo apt install awscli

# Configure credentials
aws configure

# Enter when prompted:
# AWS Access Key ID: (get from IAM Identity Center)
# AWS Secret Access Key: (get from IAM Identity Center)
# Default region: us-east-1
# Default output format: json
```

**Get IAM Identity Center Credentials**:
1. Go to IAM Identity Center portal
2. Click on your AWS account
3. Click "Command line or programmatic access"
4. Copy the credentials and paste into `~/.aws/credentials`

**Bootstrap CDK**:
```bash
# Get your AWS Account ID
aws sts get-caller-identity
# Note the "Account" number

# Bootstrap CDK
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1

# Example: cdk bootstrap aws://123456789012/us-east-1
```

**Expected Result**: 
```
✅ Environment aws://123456789012/us-east-1 bootstrapped
```

**What was created**:
- S3 bucket: `cdk-hnb659fds-assets-{account}-us-east-1`
- IAM roles for CDK deployments
- ECR repository for Docker images (if needed)

---


### Step 2.6: Install Lambda Powertools and Dependencies

**What**: Install the libraries we'll use throughout the project.

**Why**: Lambda Powertools provides structured logging, tracing, and metrics. Other libraries help with validation and ID generation.

**How**:
```bash
# Install Lambda Powertools (all three pillars)
npm install @aws-lambda-powertools/logger
npm install @aws-lambda-powertools/tracer  
npm install @aws-lambda-powertools/metrics
npm install @aws-lambda-powertools/idempotency

# Install validation and utility libraries
npm install zod          # Schema validation
npm install uuid         # UUID generation
npm install @types/uuid  # TypeScript types for uuid

# Install AWS SDK v3 (if not already included)
npm install @aws-sdk/client-dynamodb
npm install @aws-sdk/lib-dynamodb
npm install @aws-sdk/client-s3
npm install @aws-sdk/client-sqs
npm install @aws-sdk/client-ses
npm install @aws-sdk/client-secrets-manager
npm install @aws-sdk/client-ssm

# Install development dependencies
npm install --save-dev @types/node
npm install --save-dev @types/aws-lambda
npm install --save-dev jest
npm install --save-dev ts-jest
npm install --save-dev @types/jest
npm install --save-dev eslint
npm install --save-dev prettier
```

**Expected Result**: All packages installed successfully, `package.json` updated

**Verify Installation**:
```bash
npm list @aws-lambda-powertools/logger
# Should show version number
```

---

### Step 2.7: Create Project Folder Structure

**What**: Organize code into logical directories.

**Why**: Clean structure makes code easier to navigate and maintain.

**How**:
```bash
# Create directory structure
mkdir -p lib/stacks
mkdir -p lib/constructs
mkdir -p lambda
mkdir -p test/stacks
mkdir -p test/lambda
mkdir -p .github/workflows

# Verify structure
tree -L 2
# Or on Windows: dir /s /b
```

**Expected Structure**:
```
event-ticketing-v2/
├── bin/
│   └── event-ticketing-v2.ts
├── lib/
│   ├── stacks/           # CDK stacks
│   └── constructs/       # Reusable constructs
├── lambda/               # Lambda function code
├── test/
│   ├── stacks/          # Stack tests
│   └── lambda/          # Lambda tests
├── .github/
│   └── workflows/       # CI/CD workflows
├── node_modules/
├── package.json
├── tsconfig.json
└── cdk.json
```

**Expected Result**: Directories created successfully

---

### Step 2.8: Configure Git and Create .gitignore

**What**: Set up Git configuration and ignore files that shouldn't be committed.

**Why**: Prevents committing sensitive data, build artifacts, and dependencies.

**How**:
```bash
# Configure Git (if not already done)
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Create/update .gitignore
cat > .gitignore << 'EOF'
# CDK
*.js
*.d.ts
node_modules
cdk.out
.cdk.staging

# Environment variables
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Test coverage
coverage/
.nyc_output/

# Build
dist/
build/

# Secrets (NEVER commit these!)
*.pem
*.key
credentials
config
EOF
```

**Expected Result**: `.gitignore` file created

**Important**: NEVER commit:
- `.env` files with secrets
- AWS credentials
- Private keys
- `node_modules/` directory

---

### Step 2.9: Set Up Pre-commit Hooks

**What**: Automatically run checks before each commit.

**Why**: Catches errors early, ensures code quality, prevents broken commits.

**How**:
```bash
# Install husky for Git hooks
npm install --save-dev husky

# Initialize husky
npx husky install

# Create pre-commit hook
npx husky add .husky/pre-commit "npm run lint && npm run test && npm run build"

# Add scripts to package.json
```

Edit `package.json` and add these scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "jest",
    "lint": "eslint . --ext .ts",
    "lint:fix": "eslint . --ext .ts --fix",
    "format": "prettier --write \"**/*.ts\"",
    "cdk": "cdk"
  }
}
```

**Configure ESLint**:
```bash
# Create .eslintrc.json
cat > .eslintrc.json << 'EOF'
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off"
  }
}
EOF
```

**Configure Prettier**:
```bash
# Create .prettierrc
cat > .prettierrc << 'EOF'
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
EOF
```

**Expected Result**: Pre-commit hooks run automatically on `git commit`

---

### Step 2.10: Create Environment Configuration

**What**: Set up environment-specific configuration.

**Why**: Different settings for dev/staging/prod environments.

**How**:
```bash
# Create .env.example (template for others)
cat > .env.example << 'EOF'
# AWS Configuration
AWS_ACCOUNT_ID=690081480550
AWS_REGION=us-east-1

# Environment
ENVIRONMENT=dev

# Project
PROJECT_NAME=event-ticketing-v2

# Stripe (get from https://stripe.com)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Email
SES_FROM_EMAIL=noreply@yourdomain.com
SES_REPLY_TO_EMAIL=support@yourdomain.com

# Domain (optional, for later)
DOMAIN_NAME=yourdomain.com
EOF

# Create actual .env file (copy from example)
cp .env.example .env

# Edit .env with your actual values
# IMPORTANT: Never commit .env file!
```

**Expected Result**: `.env.example` committed to Git, `.env` in `.gitignore`

---

## Part 3: CDK Stack Scaffolding (Days 3-4)

### Step 3.1: Create FoundationStack

**What**: Create the base infrastructure stack with KMS keys and networking.

**Why**: Foundation resources are used by other stacks.

**How**:
```bash
# Create the stack file
touch lib/stacks/foundation-stack.ts
```

Edit `lib/stacks/foundation-stack.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface FoundationStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class FoundationStack extends cdk.Stack {
  public readonly databaseEncryptionKey: kms.Key;
  public readonly storageEncryptionKey: kms.Key;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    // KMS Key for DynamoDB encryption
    this.databaseEncryptionKey = new kms.Key(this, 'DatabaseEncryptionKey', {
      description: `${props.projectName} DynamoDB encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep key if stack deleted
    });

    // KMS Key for S3 encryption
    this.storageEncryptionKey = new kms.Key(this, 'StorageEncryptionKey', {
      description: `${props.projectName} S3 encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // VPC (optional - Lambdas can run without VPC)
    // Uncomment if you want VPC for future use
    /*
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // No NAT gateways to save cost
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    */

    // Tags for cost allocation
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseKeyArn', {
      value: this.databaseEncryptionKey.keyArn,
      exportName: `${props.projectName}-${props.environment}-db-key-arn`,
    });

    new cdk.CfnOutput(this, 'StorageKeyArn', {
      value: this.storageEncryptionKey.keyArn,
      exportName: `${props.projectName}-${props.environment}-storage-key-arn`,
    });
  }
}
```

**What this does**:
- Creates KMS keys for encrypting DynamoDB and S3
- Enables automatic key rotation (security best practice)
- Adds cost allocation tags
- Exports key ARNs for use in other stacks

**Expected Result**: TypeScript file compiles without errors

---


### Step 3.2-3.7: Create Remaining Stack Skeletons

**What**: Create placeholder files for all other stacks.

**Why**: Establishes the complete project structure before implementing details.

**How**:
```bash
# Create all stack files
touch lib/stacks/auth-stack.ts
touch lib/stacks/database-stack.ts
touch lib/stacks/storage-stack.ts
touch lib/stacks/messaging-stack.ts
touch lib/stacks/api-stack.ts
touch lib/stacks/observability-stack.ts
```

**Create a simple template for each** (we'll implement fully in Week 2):

`lib/stacks/auth-stack.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class AuthStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    
    // TODO: Implement Cognito User Pool in Week 2
    
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
  }
}
```

**Repeat similar structure for**:
- `database-stack.ts` (DynamoDB tables)
- `storage-stack.ts` (S3 buckets)
- `messaging-stack.ts` (SQS queues)
- `api-stack.ts` (API Gateway + Lambdas)
- `observability-stack.ts` (CloudWatch dashboards)

**Expected Result**: All stack files created with basic structure

---

### Step 3.8: Configure Stack Dependencies in CDK App

**What**: Wire up all stacks in the main CDK app file.

**Why**: Defines deployment order and passes resources between stacks.

**How**:

Edit `bin/event-ticketing-v2.ts`:
```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

const app = new cdk.App();

// Get configuration from environment or context
const environment = process.env.ENVIRONMENT || 'dev';
const projectName = process.env.PROJECT_NAME || 'event-ticketing-v2';
const account = process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.AWS_REGION || 'us-east-1';

const env = { account, region };

// 1. Foundation Stack (KMS keys, networking)
const foundationStack = new FoundationStack(app, `${projectName}-foundation-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Foundation infrastructure: KMS keys and networking',
});

// 2. Auth Stack (Cognito)
const authStack = new AuthStack(app, `${projectName}-auth-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Authentication: Cognito User Pool and Identity Pool',
});

// 3. Database Stack (DynamoDB)
const databaseStack = new DatabaseStack(app, `${projectName}-database-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Database: DynamoDB tables with GSIs',
});
databaseStack.addDependency(foundationStack); // Needs KMS keys

// 4. Storage Stack (S3)
const storageStack = new StorageStack(app, `${projectName}-storage-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Storage: S3 buckets for tickets and frontend',
});
storageStack.addDependency(foundationStack); // Needs KMS keys

// 5. Messaging Stack (SQS, EventBridge)
const messagingStack = new MessagingStack(app, `${projectName}-messaging-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Messaging: SQS queues and EventBridge',
});

// 6. API Stack (API Gateway, Lambda)
const apiStack = new ApiStack(app, `${projectName}-api-${environment}`, {
  env,
  environment,
  projectName,
  description: 'API: HTTP API Gateway and Lambda functions',
});
apiStack.addDependency(authStack);      // Needs Cognito
apiStack.addDependency(databaseStack);  // Needs DynamoDB
apiStack.addDependency(storageStack);   // Needs S3
apiStack.addDependency(messagingStack); // Needs SQS

// 7. Observability Stack (CloudWatch)
const observabilityStack = new ObservabilityStack(app, `${projectName}-observability-${environment}`, {
  env,
  environment,
  projectName,
  description: 'Observability: CloudWatch dashboards and alarms',
});
observabilityStack.addDependency(apiStack); // Monitors API resources

app.synth();
```

**What this does**:
- Creates all 7 stacks
- Defines dependencies (deployment order)
- Passes configuration from environment variables
- Tags all resources automatically

**Expected Result**: `cdk synth` runs without errors

---

## Part 4: Reusable CDK Constructs (Day 5)

### Step 4.1: Create SecureLambda Construct

**What**: A reusable construct that creates Lambda functions with best practices built-in.

**Why**: Every Lambda needs the same security and observability features. This construct ensures consistency.

**How**:
```bash
touch lib/constructs/secure-lambda.ts
```

Edit `lib/constructs/secure-lambda.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SecureLambdaProps {
  functionName: string;
  description: string;
  handler: string;
  code: lambda.Code;
  environment?: { [key: string]: string };
  timeout?: cdk.Duration;
  memorySize?: number;
  architecture?: lambda.Architecture;
}

export class SecureLambda extends Construct {
  public readonly function: lambda.Function;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: SecureLambdaProps) {
    super(scope, id);

    // Dead Letter Queue for failed invocations
    this.deadLetterQueue = new sqs.Queue(this, 'DLQ', {
      queueName: `${props.functionName}-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Lambda function with best practices
    this.function = new lambda.Function(this, 'Function', {
      functionName: props.functionName,
      description: props.description,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: props.architecture || lambda.Architecture.ARM_64, // 20% cost savings
      handler: props.handler,
      code: props.code,
      timeout: props.timeout || cdk.Duration.seconds(30),
      memorySize: props.memorySize || 256,
      environment: {
        ...props.environment,
        // Lambda Powertools environment variables
        POWERTOOLS_SERVICE_NAME: props.functionName,
        POWERTOOLS_METRICS_NAMESPACE: 'EventTicketing',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE, // Enable X-Ray
      deadLetterQueue: this.deadLetterQueue,
      logRetention: logs.RetentionDays.ONE_WEEK,
      reservedConcurrentExecutions: undefined, // No limit (can set per function)
    });

    // Grant X-Ray permissions
    this.function.addToRolePolicy(new iam.PolicyStatement({
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    }));

    // Output DLQ URL for monitoring
    new cdk.CfnOutput(this, 'DLQUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: `DLQ for ${props.functionName}`,
    });
  }

  // Helper method to grant DynamoDB permissions
  public grantDynamoDBAccess(tableArn: string, actions: string[]) {
    this.function.addToRolePolicy(new iam.PolicyStatement({
      actions,
      resources: [tableArn, `${tableArn}/index/*`],
    }));
  }

  // Helper method to grant S3 permissions
  public grantS3Access(bucketArn: string, actions: string[]) {
    this.function.addToRolePolicy(new iam.PolicyStatement({
      actions,
      resources: [bucketArn, `${bucketArn}/*`],
    }));
  }

  // Helper method to grant Secrets Manager access
  public grantSecretsAccess(secretArn: string) {
    this.function.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [secretArn],
    }));
  }
}
```

**What this provides**:
- ARM64 architecture (20% cost savings)
- X-Ray tracing enabled
- Dead Letter Queue for failed invocations
- Lambda Powertools environment variables
- Log retention (1 week)
- Helper methods for granting permissions

**Expected Result**: Construct compiles without errors

---

### Step 4.2: Create SecureApi Construct

**What**: Reusable construct for HTTP API with WAF and Cognito authorizer.

**Why**: Ensures all APIs have consistent security configuration.

**How**:
```bash
touch lib/constructs/secure-api.ts
```

Edit `lib/constructs/secure-api.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface SecureApiProps {
  apiName: string;
  description: string;
  corsAllowOrigins?: string[];
}

export class SecureApi extends Construct {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: SecureApiProps) {
    super(scope, id);

    // HTTP API (v2) - cheaper and simpler than REST API
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: props.apiName,
      description: props.description,
      corsPreflight: {
        allowOrigins: props.corsAllowOrigins || ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // WAF Web ACL
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${props.apiName}-waf`,
      },
      rules: [
        // AWS Managed Rules - Core Rule Set
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
          },
        },
        // Rate limiting: 100 requests per 5 minutes per IP
        {
          name: 'RateLimitRule',
          priority: 2,
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitMetric',
          },
        },
      ],
    });

    // Associate WAF with API Gateway
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.httpApi.apiArn,
      webAclArn: this.webAcl.attrArn,
    });

    // Output API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.url!,
      description: `${props.apiName} URL`,
    });
  }
}
```

**What this provides**:
- HTTP API v2 (60% cheaper than REST API)
- CORS configuration
- WAF with AWS managed rules
- Rate limiting (100 req/5min per IP)
- Automatic API URL output

**Expected Result**: Construct compiles without errors

---


### Step 4.3: Create MonitoredTable Construct

**What**: Reusable construct for DynamoDB tables with monitoring built-in.

**Why**: Ensures all tables have consistent configuration, encryption, and alarms.

**How**:
```bash
touch lib/constructs/monitored-table.ts
```

Edit `lib/constructs/monitored-table.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface MonitoredTableProps {
  tableName: string;
  partitionKey: dynamodb.Attribute;
  sortKey?: dynamodb.Attribute;
  encryptionKey: kms.IKey;
  globalSecondaryIndexes?: dynamodb.GlobalSecondaryIndexProps[];
  stream?: dynamodb.StreamViewType;
}

export class MonitoredTable extends Construct {
  public readonly table: dynamodb.Table;
  public readonly throttleAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoredTableProps) {
    super(scope, id);

    // DynamoDB table with best practices
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: props.tableName,
      partitionKey: props.partitionKey,
      sortKey: props.sortKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand scaling
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED, // KMS encryption
      encryptionKey: props.encryptionKey,
      pointInTimeRecovery: true, // Enable PITR for backups
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete table on stack deletion
      stream: props.stream, // Enable streams if specified
      timeToLiveAttribute: 'ttl', // Optional TTL attribute
    });

    // Add Global Secondary Indexes
    if (props.globalSecondaryIndexes) {
      props.globalSecondaryIndexes.forEach((gsi) => {
        this.table.addGlobalSecondaryIndex(gsi);
      });
    }

    // CloudWatch Alarm for throttled requests
    this.throttleAlarm = new cloudwatch.Alarm(this, 'ThrottleAlarm', {
      alarmName: `${props.tableName}-throttled-requests`,
      alarmDescription: `Alerts when ${props.tableName} has throttled requests`,
      metric: this.table.metricSystemErrorsForOperations({
        operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.GET_ITEM],
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Output table name and ARN
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: `${props.tableName} table name`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: `${props.tableName} table ARN`,
      exportName: `${props.tableName}-arn`,
    });
  }
}
```

**What this provides**:
- On-demand billing (auto-scaling)
- KMS encryption
- Point-in-time recovery (PITR)
- DynamoDB Streams (optional)
- CloudWatch alarm for throttling
- Automatic outputs for cross-stack references

**Expected Result**: Construct compiles without errors

---

### Step 4.4: Write Unit Tests for Constructs

**What**: Test that constructs create expected resources.

**Why**: Ensures constructs work correctly and prevents regressions.

**How**:
```bash
# Configure Jest
cat > jest.config.js << 'EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/**/*.d.ts'
  ]
};
EOF

# Create test file
touch test/constructs/secure-lambda.test.ts
```

Edit `test/constructs/secure-lambda.test.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SecureLambda } from '../../lib/constructs/secure-lambda';

describe('SecureLambda Construct', () => {
  test('creates Lambda function with X-Ray tracing', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new SecureLambda(stack, 'TestLambda', {
      functionName: 'test-function',
      description: 'Test function',
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {}'),
    });

    const template = Template.fromStack(stack);

    // Assert Lambda function exists
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'test-function',
      Runtime: 'nodejs20.x',
      TracingConfig: {
        Mode: 'Active', // X-Ray enabled
      },
    });
  });

  test('creates Dead Letter Queue', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new SecureLambda(stack, 'TestLambda', {
      functionName: 'test-function',
      description: 'Test function',
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {}'),
    });

    const template = Template.fromStack(stack);

    // Assert DLQ exists
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'test-function-dlq',
    });
  });

  test('uses ARM64 architecture by default', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new SecureLambda(stack, 'TestLambda', {
      functionName: 'test-function',
      description: 'Test function',
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {}'),
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
    });
  });
});
```

**Run tests**:
```bash
npm test
```

**Expected Result**: All tests pass ✓

---

## Part 5: First Deployment Test (Day 5)

### Step 5.1: Compile TypeScript

**What**: Compile TypeScript to JavaScript.

**Why**: CDK needs JavaScript to deploy.

**How**:
```bash
npm run build
```

**Expected Result**: No compilation errors, `.js` files created in `lib/` directory

**Common Errors**:
- `Cannot find module`: Run `npm install`
- Type errors: Fix TypeScript syntax
- Missing imports: Add import statements

---

### Step 5.2: Synthesize CloudFormation Templates

**What**: Generate CloudFormation templates from CDK code.

**Why**: Validates CDK code and shows what will be deployed.

**How**:
```bash
cdk synth
```

**Expected Result**: 
- CloudFormation YAML templates generated in `cdk.out/` directory
- No errors
- You see template output in terminal

**What to check**:
- Look for your stack names
- Verify resources are created (KMS keys, etc.)
- Check for any warnings

---

### Step 5.3: View Deployment Diff

**What**: See what changes will be made to AWS.

**Why**: Preview before deploying to avoid surprises.

**How**:
```bash
cdk diff
```

**Expected Result**: 
- Shows resources that will be created (all new since first deployment)
- No destructive changes (since nothing exists yet)

**Example output**:
```
Stack event-ticketing-v2-foundation-dev
Resources
[+] AWS::KMS::Key DatabaseEncryptionKey
[+] AWS::KMS::Key StorageEncryptionKey
```

---

### Step 5.4: Deploy Foundation Stack

**What**: Deploy the first stack to AWS.

**Why**: Test that everything works end-to-end.

**How**:
```bash
# Deploy only Foundation stack
cdk deploy event-ticketing-v2-foundation-dev

# Or deploy all stacks (they're mostly empty for now)
cdk deploy --all
```

**What happens**:
1. CDK uploads assets to S3
2. CloudFormation creates resources
3. You see progress in terminal
4. Takes 2-5 minutes

**Expected Result**:
```
✅  event-ticketing-v2-foundation-dev

Outputs:
event-ticketing-v2-foundation-dev.DatabaseKeyArn = arn:aws:kms:us-east-1:...
event-ticketing-v2-foundation-dev.StorageKeyArn = arn:aws:kms:us-east-1:...

Stack ARN:
arn:aws:cloudformation:us-east-1:...
```

**Verify in AWS Console**:
1. Go to CloudFormation console
2. See your stack with "CREATE_COMPLETE" status
3. Go to KMS console
4. See your encryption keys

---

### Step 5.5: Commit and Push to GitHub

**What**: Save your work to Git.

**Why**: Version control and backup.

**How**:
```bash
# Check status
git status

# Add all files
git add .

# Commit
git commit -m "feat: Phase 1 complete - Foundation setup with CDK"

# Push to GitHub
git push origin main
```

**Expected Result**: Code pushed to GitHub successfully

---

## Phase 1 Complete! 🎉

### What You've Accomplished

✅ **AWS Account Hardened**:
- MFA enabled on root
- IAM Identity Center configured
- GuardDuty, Security Hub, CloudTrail enabled
- Budget alerts set

✅ **CDK Project Initialized**:
- Repository created with branch protection
- CDK installed and bootstrapped
- Lambda Powertools installed
- Project structure created

✅ **Infrastructure Foundation**:
- 7 CDK stacks scaffolded
- 3 reusable constructs created
- Unit tests written
- First stack deployed successfully

### Next Steps

**Week 2 (Phase 2)**: Implement the core infrastructure stacks:
- AuthStack: Cognito User Pool with Organizers/Attendees groups
- DatabaseStack: 3 DynamoDB tables with GSIs
- StorageStack: S3 buckets for tickets and frontend
- MessagingStack: SQS FIFO queue for async ticket generation

### Troubleshooting Common Issues

**Issue**: `cdk command not found`
**Solution**: Run `npm install -g aws-cdk` again, or use `npx cdk` instead

**Issue**: `Unable to resolve AWS account`
**Solution**: Run `aws configure` and set credentials

**Issue**: `Stack already exists`
**Solution**: Run `cdk destroy` to delete, then redeploy

**Issue**: TypeScript compilation errors
**Solution**: Check `tsconfig.json`, run `npm install`, fix syntax errors

**Issue**: Permission denied errors
**Solution**: Check IAM permissions, ensure admin access

### Cost Tracking

After Phase 1, your monthly costs should be:
- GuardDuty: ~$5 (30-day free trial)
- CloudTrail: ~$2
- AWS Config: ~$2
- KMS keys: ~$2
- **Total: ~$11/month**

Check AWS Cost Explorer to verify.

---

## Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Lambda Powertools TypeScript](https://docs.powertools.aws.dev/lambda/typescript/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [CDK Patterns](https://cdkpatterns.com/)

---

**Ready for Phase 2?** Let me know when you've completed Phase 1 and we'll move on to implementing the core infrastructure stacks!
