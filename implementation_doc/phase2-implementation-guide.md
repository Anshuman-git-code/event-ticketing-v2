# Phase 2 Implementation Guide: Core Infrastructure Deployment

## Overview

This guide provides step-by-step instructions for Phase 2 (Week 2) of the Event Ticketing System V2 project. Each step includes detailed explanations, the exact code already written for you, commands to run, and what to expect.

**Duration**: Week 2 (5-7 days)  
**Goal**: Implement and deploy all core infrastructure stacks — Auth, Database, Storage, Messaging, and WAF

**What Phase 1 gave us**:
- ✅ CDK project scaffolded and committed to GitHub
- ✅ FoundationStack deployed (2 KMS keys live in AWS)
- ✅ All stack skeleton files created
- ✅ All 3 reusable constructs created

**What Phase 2 will give us**:
- Cognito User Pool with Organizers/Attendees groups
- 3 DynamoDB tables with 10 GSIs, encryption, PITR, and streams
- 2 S3 buckets (tickets + frontend) with KMS encryption
- SQS FIFO queue + DLQ for async ticket generation
- EventBridge custom event bus
- WAF WebACL protecting the API

---

## Important: Deployment Order

Always deploy in this order — each stack depends on the previous:

```
1. FoundationStack  ✅ ALREADY DEPLOYED
2. AuthStack        ← Deploy first in Phase 2
3. DatabaseStack    ← Depends on FoundationStack (KMS key)
4. StorageStack     ← Depends on FoundationStack (KMS key)
5. MessagingStack   ← No dependencies
```

---

## Part 1: AuthStack — Cognito User Pool (Day 6)

### Step 6.1: Understand What We Are Building

**What**: Cognito User Pool is AWS's managed authentication service. It handles user registration, login, password reset, and JWT token generation.

**Why**: Every API endpoint (except public event listing) requires authentication. Cognito gives us:
- Secure user registration and login
- JWT tokens that API Gateway validates automatically
- User groups (Organizers vs Attendees) for role-based access
- Email verification out of the box

**How it works in our system**:
1. User registers → Cognito sends verification email
2. User verifies email → account activated
3. User logs in → Cognito returns JWT access token
4. User calls API → sends JWT in `Authorization: Bearer <token>` header
5. API Gateway validates JWT with Cognito automatically — no Lambda code needed

---

### Step 6.2: Implement AuthStack

**What**: The `auth-stack.ts` file currently has a placeholder. We need to implement the full Cognito User Pool.

**Why each setting matters**:
- `signInAliases: { email: true }` — users log in with email, not username
- `selfSignUpEnabled: true` — users can register themselves (no admin needed)
- `passwordPolicy` — enforces strong passwords
- `accountRecovery: EMAIL_ONLY` — password reset via email only (more secure than phone)
- `removalPolicy: RETAIN` — NEVER delete user accounts if stack is destroyed

**How**: Replace the contents of `lib/stacks/auth-stack.ts` with this complete implementation:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ==========================================
    // Cognito User Pool
    // ==========================================
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.projectName}-users-${props.environment}`,

      // Users sign in with email address
      signInAliases: { email: true },
      signInCaseSensitive: false,

      // Users can register themselves
      selfSignUpEnabled: true,

      // Require email verification before account is active
      autoVerify: { email: true },

      // What info we collect at signup
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },

      // Password requirements
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false, // Keep it simple for users
        tempPasswordValidity: cdk.Duration.days(7),
      },

      // Account recovery via email only
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Email configuration (uses Cognito default for now)
      userVerification: {
        emailSubject: 'Verify your Event Ticketing account',
        emailBody: 'Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },

      // Keep user pool if stack is deleted (NEVER lose user accounts!)
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ==========================================
    // User Pool Client (used by frontend app)
    // ==========================================
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${props.projectName}-web-client-${props.environment}`,

      // Auth flows supported
      authFlows: {
        userSrp: true,       // Secure Remote Password (recommended)
        userPassword: false, // Don't allow plain password auth
        adminUserPassword: false,
      },

      // Token expiry settings
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      // Don't generate client secret (not needed for browser apps)
      generateSecret: false,

      // Prevent user existence errors (security best practice)
      preventUserExistenceErrors: true,
    });

    // ==========================================
    // User Groups (for role-based access)
    // ==========================================

    // Organizers group — can create/manage events
    new cognito.CfnUserPoolGroup(this, 'OrganizersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Organizers',
      description: 'Event organizers who can create and manage events',
    });

    // Attendees group — can register for events
    new cognito.CfnUserPoolGroup(this, 'AttendeesGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Attendees',
      description: 'Event attendees who can register and get tickets',
    });

    // ==========================================
    // Store IDs in SSM Parameter Store
    // Lambda functions and frontend will read these
    // ==========================================
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/event-ticketing/${props.environment}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: `/event-ticketing/${props.environment}/cognito/client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${props.projectName}-${props.environment}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${props.projectName}-${props.environment}-user-pool-client-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN (needed for API Gateway authorizer)',
      exportName: `${props.projectName}-${props.environment}-user-pool-arn`,
    });
  }
}
```

**What this code does**:
- Creates a Cognito User Pool where users sign in with email
- Enforces password policy (min 8 chars, uppercase, lowercase, digits)
- Creates two groups: `Organizers` and `Attendees`
- Stores the User Pool ID and Client ID in SSM Parameter Store so Lambda functions can read them without hardcoding
- Exports IDs as CloudFormation outputs for easy reference

---

### Step 6.3: Deploy AuthStack

**What**: Push the Cognito User Pool to AWS.

**Why**: We need the User Pool to exist before we can test authentication.

**How**:
```bash
npx cdk deploy event-ticketing-v2-auth-dev
```

**What happens**:
1. CDK creates the Cognito User Pool
2. Creates the web client
3. Creates Organizers and Attendees groups
4. Stores IDs in SSM Parameter Store
5. Takes about 2-3 minutes

**Expected Result**:
```
✅  event-ticketing-v2-auth-dev

Outputs:
event-ticketing-v2-auth-dev.UserPoolId = us-east-1_XXXXXXXXX
event-ticketing-v2-auth-dev.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
event-ticketing-v2-auth-dev.UserPoolArn = arn:aws:cognito-idp:us-east-1:...
```

**Save these values** — you'll need them later for the frontend and API Gateway.

---

### Step 6.4: Verify AuthStack in AWS Console

**What**: Confirm everything was created correctly.

**How**:
1. Go to AWS Console → search "Cognito"
2. Click "User pools"
3. You should see `event-ticketing-v2-users-dev`
4. Click on it → check "Groups" tab → you should see `Organizers` and `Attendees`
5. Go to AWS Console → search "Systems Manager"
6. Click "Parameter Store" in left sidebar
7. You should see:
   - `/event-ticketing/dev/cognito/user-pool-id`
   - `/event-ticketing/dev/cognito/client-id`

**Expected Result**: User Pool exists with both groups, SSM parameters created

---

### Step 6.5: Test User Registration (Optional but Recommended)

**What**: Create a test user to verify the User Pool works.

**Why**: Catch any issues before building the full API.

**How** (via AWS Console):
1. In Cognito → your User Pool → click "Users" tab
2. Click "Create user"
3. Fill in:
   - Email: your test email
   - Temporary password: `Test1234!`
   - Check "Send an email invitation"
4. Click "Create user"
5. Check your email for the verification code

**Or via AWS CLI**:
```bash
# Create a test user
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com \
  --temporary-password "Test1234!" \
  --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true \
  --region us-east-1

# Add user to Organizers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com \
  --group-name Organizers \
  --region us-east-1
```

Replace `YOUR_USER_POOL_ID` with the value from the deploy output (e.g., `us-east-1_XXXXXXXXX`).

**Expected Result**: User created and added to Organizers group

---

## Part 2: DatabaseStack — DynamoDB Tables (Day 7)

### Step 7.1: Understand What We Are Building

**What**: Three DynamoDB tables that store all application data.

**Why DynamoDB**:
- Serverless — no servers to manage
- Pay-per-request — zero cost when idle
- Scales automatically to any load
- Single-digit millisecond latency
- Built-in encryption and backup

**Our three tables**:

| Table | Purpose | Partition Key |
|-------|---------|---------------|
| Events | Stores event details | `eventId` |
| Registrations | Stores who registered for what | `registrationId` |
| Tickets | Stores generated PDF ticket records | `ticketId` |

**What are GSIs (Global Secondary Indexes)?**
A GSI lets you query a table by a different key than the partition key. For example:
- Events table has `eventId` as partition key — great for `getEvent(eventId)`
- But to list all events by an organizer, we need `OrganizerIndex` GSI with `organizerId` as key
- Without GSI, you'd have to scan the entire table (slow and expensive)

**Our 10 GSIs**:

Events table (4 GSIs):
- `OrganizerIndex` — find all events by an organizer
- `DateIndex` — find upcoming events sorted by date
- `CategoryIndex` — filter events by category (music, sports, etc.)
- `StatusIndex` — filter events by status (active, cancelled, etc.)

Registrations table (3 GSIs):
- `UserIndex` — find all registrations by a user ("my registrations")
- `EventIndex` — find all registrations for an event (organizer view)
- `IdempotencyIndex` — prevent duplicate registrations

Tickets table (3 GSIs):
- `UserIndex` — find all tickets belonging to a user
- `EventIndex` — find all tickets for an event
- `QRCodeIndex` — look up a ticket by QR code during validation

---

### Step 7.2: Review DatabaseStack Code

**Good news**: The DatabaseStack is already fully implemented from Phase 1. You do NOT need to change any code. Here is what's already in `lib/stacks/database-stack.ts` for your understanding:

**Events Table** — stores event details:
```
eventId (PK)     → unique ID for each event
organizerId      → who created the event (used by OrganizerIndex GSI)
status           → "active", "cancelled", "completed" (used by DateIndex, StatusIndex GSIs)
date             → event date (used by DateIndex, CategoryIndex GSIs)
category         → "music", "sports", "tech", etc. (used by CategoryIndex GSI)
createdAt        → when the event was created
```

**Registrations Table** — stores who registered for what:
```
registrationId (PK)  → unique ID for each registration
userId               → who registered (used by UserIndex GSI)
eventId              → which event (used by EventIndex GSI)
idempotencyKey       → prevents double-registration (used by IdempotencyIndex GSI)
registeredAt         → when they registered
paymentStatus        → "pending", "confirmed", "failed"
```

**Tickets Table** — stores generated ticket records:
```
ticketId (PK)    → unique ID for each ticket
userId           → ticket owner (used by UserIndex GSI)
eventId          → which event (used by EventIndex GSI)
qrCode           → QR code value (used by QRCodeIndex GSI)
generatedAt      → when ticket was generated
status           → "generated", "validated"
s3Key            → path to PDF in S3 bucket
```

**All tables have**:
- `PAY_PER_REQUEST` billing — no capacity planning needed
- `CUSTOMER_MANAGED` KMS encryption — using the key from FoundationStack
- `pointInTimeRecoveryEnabled: true` — can restore to any point in last 35 days
- `NEW_AND_OLD_IMAGES` streams — captures before/after state for event-driven triggers
- `RETAIN` removal policy — tables are NEVER deleted even if CDK stack is destroyed

---

### Step 7.3: Deploy DatabaseStack

**What**: Create all 3 DynamoDB tables in AWS.

**Why now**: Tables need to exist before Lambda functions can write to them.

**How**:
```bash
npx cdk deploy event-ticketing-v2-database-dev
```

**What happens**:
1. CDK creates Events table with 4 GSIs
2. Creates Registrations table with 3 GSIs
3. Creates Tickets table with 3 GSIs
4. Enables encryption, PITR, and streams on all tables
5. Takes about 3-5 minutes

**Expected Result**:
```
✅  event-ticketing-v2-database-dev

Outputs:
event-ticketing-v2-database-dev.EventsTableName = event-ticketing-v2-events-dev
event-ticketing-v2-database-dev.RegistrationsTableName = event-ticketing-v2-registrations-dev
event-ticketing-v2-database-dev.TicketsTableName = event-ticketing-v2-tickets-dev
```

---

### Step 7.4: Verify DatabaseStack in AWS Console

**How**:
1. Go to AWS Console → search "DynamoDB"
2. Click "Tables" in left sidebar
3. You should see 3 tables:
   - `event-ticketing-v2-events-dev`
   - `event-ticketing-v2-registrations-dev`
   - `event-ticketing-v2-tickets-dev`
4. Click on `event-ticketing-v2-events-dev`
5. Click "Indexes" tab → you should see 4 GSIs
6. Click "Exports and streams" tab → DynamoDB Streams should show "Enabled"
7. Click "Additional settings" tab → Encryption should show "AWS owned key" or your KMS key

**Expected Result**: All 3 tables exist with correct GSIs and settings

---

## Part 3: StorageStack — S3 Buckets (Day 7)

### Step 8.1: Understand What We Are Building

**What**: Two S3 buckets for storing files.

**Why S3**:
- Virtually unlimited storage
- 99.999999999% (11 nines) durability
- Pay only for what you store
- Built-in versioning and lifecycle management

**Our two buckets**:

| Bucket | Purpose | Access |
|--------|---------|--------|
| Tickets bucket | Stores generated PDF ticket files | Private — only Lambda can access |
| Frontend bucket | Hosts the React web app | Private — only CloudFront can access |

**Why private buckets?**
- Tickets contain personal data — only the ticket owner should access them
- We generate pre-signed URLs (temporary, time-limited links) for downloads
- Frontend is served through CloudFront CDN, not directly from S3

**Lifecycle rules on tickets bucket**:
- Old versions of ticket PDFs are deleted after 7 days
- This saves storage costs (if a ticket PDF is regenerated, old version is cleaned up)

---

### Step 8.2: Review StorageStack Code

**Good news**: StorageStack is already fully implemented. Here's what's in `lib/stacks/storage-stack.ts`:

**Tickets Bucket settings**:
- `versioned: true` — keeps history of all uploaded files
- `BucketEncryption.KMS` — encrypted with our KMS key from FoundationStack
- `BlockPublicAccess.BLOCK_ALL` — absolutely no public access
- `enforceSSL: true` — all requests must use HTTPS
- `RemovalPolicy.RETAIN` — bucket is never deleted (tickets are important!)
- Lifecycle rule: delete old versions after 7 days

**Frontend Bucket settings**:
- Same security settings as tickets bucket
- `RemovalPolicy.DESTROY` + `autoDeleteObjects: true` — can be deleted (frontend can be redeployed)

---

### Step 8.3: Deploy StorageStack

**How**:
```bash
npx cdk deploy event-ticketing-v2-storage-dev
```

**What happens**:
1. CDK creates tickets S3 bucket with KMS encryption
2. Creates frontend S3 bucket
3. Configures lifecycle rules
4. Takes about 1-2 minutes

**Expected Result**:
```
✅  event-ticketing-v2-storage-dev

Outputs:
event-ticketing-v2-storage-dev.TicketsBucketName = event-ticketing-v2-tickets-dev-690081480550
event-ticketing-v2-storage-dev.FrontendBucketName = event-ticketing-v2-frontend-dev-690081480550
```

Note: Your AWS account ID (690081480550) is appended to bucket names to ensure global uniqueness.

---

### Step 8.4: Verify StorageStack in AWS Console

**How**:
1. Go to AWS Console → search "S3"
2. You should see 2 new buckets:
   - `event-ticketing-v2-tickets-dev-690081480550`
   - `event-ticketing-v2-frontend-dev-690081480550`
3. Click on the tickets bucket
4. Click "Properties" tab → check:
   - Versioning: Enabled
   - Default encryption: AWS KMS (your key)
5. Click "Permissions" tab → check:
   - Block all public access: ON (all 4 checkboxes)

**Expected Result**: Both buckets exist with correct security settings

---

## Part 4: MessagingStack — SQS + EventBridge (Day 8)

### Step 9.1: Understand What We Are Building

**What**: An SQS FIFO queue for async ticket generation and an EventBridge custom event bus.

**Why async ticket generation?**

This is one of the most important architectural decisions in V2. In V1, ticket generation was synchronous:

```
V1 (BAD):
User registers → HTTP waits...
  → DynamoDB write (5ms)
  → Stripe API call (300ms)
  → QR Code generation (100ms)
  → PDF generation (800ms)
  → S3 upload (200ms)
← Response (1400ms total) ← User waited 1.4 seconds!
```

In V2, we use SQS to decouple registration from ticket generation:

```
V2 (GOOD):
User registers → HTTP responds instantly!
  → DynamoDB write (5ms)
  → Send SQS message (10ms)
← Response: 201 Created (15ms!) ← User gets response immediately

ASYNC (background, user does not wait):
  SQS triggers generateTicket Lambda
  → PDF + QR generated
  → S3 upload
  → DynamoDB updated
  → SES sends ticket email to user
```

**Why FIFO queue?**
- FIFO = First In, First Out — messages processed in order
- `contentBasedDeduplication: true` — if same message sent twice, only processed once
- This prevents duplicate tickets if the registration Lambda retries

**What is the Dead Letter Queue (DLQ)?**
- If ticket generation fails 3 times, the message goes to the DLQ
- DLQ holds failed messages for 14 days
- We can inspect them to understand what went wrong
- An alarm fires when DLQ has messages (Week 4)

**What is EventBridge?**
- A serverless event bus for routing events between services
- We'll use it in Phase 6 for events like `registration.confirmed` → send email
- For now, it's created but not yet connected to anything

---

### Step 9.2: Review MessagingStack Code

**Good news**: MessagingStack is already fully implemented. Here's what's in `lib/stacks/messaging-stack.ts`:

**DLQ settings**:
- FIFO queue (must match main queue type)
- Retains messages for 14 days (time to investigate failures)

**Main Queue settings**:
- `fifo: true` — ordered processing
- `contentBasedDeduplication: true` — auto-deduplication based on message content
- `visibilityTimeout: 30 seconds` — Lambda has 30 seconds to process before message becomes visible again
- `maxReceiveCount: 3` — retry 3 times before sending to DLQ
- `retentionPeriod: 4 days` — messages kept for 4 days if not processed

---

### Step 9.3: Deploy MessagingStack

**How**:
```bash
npx cdk deploy event-ticketing-v2-messaging-dev
```

**What happens**:
1. CDK creates the DLQ (FIFO)
2. Creates the main ticket generation queue (FIFO) with DLQ attached
3. Creates the EventBridge custom event bus
4. Takes about 1-2 minutes

**Expected Result**:
```
✅  event-ticketing-v2-messaging-dev

Outputs:
event-ticketing-v2-messaging-dev.TicketQueueUrl = https://sqs.us-east-1.amazonaws.com/690081480550/event-ticketing-v2-ticket-generation-dev.fifo
event-ticketing-v2-messaging-dev.TicketDLQUrl = https://sqs.us-east-1.amazonaws.com/690081480550/event-ticketing-v2-ticket-generation-dlq-dev.fifo
event-ticketing-v2-messaging-dev.EventBusName = event-ticketing-v2-events-dev
```

---

### Step 9.4: Verify MessagingStack in AWS Console

**How**:
1. Go to AWS Console → search "SQS"
2. You should see 2 queues:
   - `event-ticketing-v2-ticket-generation-dev.fifo`
   - `event-ticketing-v2-ticket-generation-dlq-dev.fifo`
3. Click on the main queue
4. Check "Details" tab:
   - Type: FIFO
   - Content-based deduplication: Enabled
   - Dead-letter queue: points to the DLQ
5. Go to AWS Console → search "EventBridge"
6. Click "Event buses" in left sidebar
7. You should see `event-ticketing-v2-events-dev`

**Expected Result**: Both queues and event bus exist with correct settings

---

## Part 5: WAF Configuration (Day 8)

### Step 10.1: Understand What We Are Building

**What**: WAF (Web Application Firewall) protects our API from malicious traffic.

**Why WAF**:
- V1 had NO WAF — API was completely exposed to bots and attacks
- WAF blocks common attacks automatically (SQL injection, XSS, etc.)
- Rate limiting prevents abuse (someone hammering your API)
- AWS Managed Rules are maintained by AWS security team

**What WAF blocks**:
- `AWSManagedRulesCommonRuleSet` — blocks common web exploits (SQL injection, XSS, etc.)
- `AWSManagedRulesKnownBadInputsRuleSet` — blocks known malicious request patterns
- Rate limit rule — blocks IPs making more than 100 requests per 5 minutes

**Cost**: ~$6/month ($5 per WebACL + $1 per rule group)

---

### Step 10.2: Add WAF to FoundationStack

**What**: WAF needs to be added to the FoundationStack because it will be shared across API Gateway and CloudFront.

**Why in FoundationStack**: WAF WebACL is a shared resource. Putting it in FoundationStack means both the API and CloudFront (added in Phase 5) can reference the same WebACL.

**How**: Update `lib/stacks/foundation-stack.ts` — add WAF after the KMS keys:

Add the following import at the top of `lib/stacks/foundation-stack.ts` (after the existing imports):

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
```

Then add the `webAcl` property to the class and the WAF code inside the constructor. Here is the complete updated `lib/stacks/foundation-stack.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface FoundationStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class FoundationStack extends cdk.Stack {
  public readonly databaseEncryptionKey: kms.Key;
  public readonly storageEncryptionKey: kms.Key;
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    // KMS Key for DynamoDB encryption
    this.databaseEncryptionKey = new kms.Key(this, 'DatabaseEncryptionKey', {
      description: `${props.projectName} DynamoDB encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // KMS Key for S3 encryption
    this.storageEncryptionKey = new kms.Key(this, 'StorageEncryptionKey', {
      description: `${props.projectName} S3 encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ==========================================
    // WAF WebACL — protects API Gateway and CloudFront
    // ==========================================
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${props.projectName}-waf-${props.environment}`,
      scope: 'REGIONAL', // REGIONAL for API Gateway; CLOUDFRONT must be in us-east-1
      defaultAction: { allow: {} }, // Allow by default, rules block specific threats
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${props.projectName}-waf-${props.environment}`,
      },
      rules: [
        // Rule 1: AWS Managed Core Rule Set
        // Blocks common web exploits: SQL injection, XSS, path traversal, etc.
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          overrideAction: { none: {} }, // Use the rule group's own actions
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
          },
        },
        // Rule 2: Known Bad Inputs Rule Set
        // Blocks requests with patterns known to be malicious
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSetMetric',
          },
        },
        // Rule 3: Rate Limiting
        // Blocks any single IP making more than 100 requests in 5 minutes
        {
          name: 'RateLimitRule',
          priority: 3,
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

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF WebACL ARN — used by API Gateway and CloudFront',
      exportName: `${props.projectName}-${props.environment}-waf-arn`,
    });
  }
}
```

**What this code does**:
- Creates a WAF WebACL with `REGIONAL` scope (for API Gateway)
- Rule 1 blocks common web attacks (SQL injection, XSS, path traversal)
- Rule 2 blocks known malicious request patterns
- Rule 3 blocks any IP that sends more than 100 requests in 5 minutes
- Exports the WebACL ARN so ApiStack can attach it to API Gateway
- CloudWatch metrics enabled so you can see blocked requests in the console

**Why `REGIONAL` scope?**
WAF has two scopes:
- `REGIONAL` — protects API Gateway, Application Load Balancer (must be in same region)
- `CLOUDFRONT` — protects CloudFront distributions (must be deployed in `us-east-1`)

We use `REGIONAL` here. When we add CloudFront in Phase 5, we'll create a separate `CLOUDFRONT` scoped WebACL.

---

### Step 10.3: Update FoundationStack File

**What**: Replace the current `lib/stacks/foundation-stack.ts` with the complete version above.

**How**: Open `lib/stacks/foundation-stack.ts` in your editor and replace the entire contents with the code from Step 10.2.

After saving, verify it compiles:

```bash
npm run build
```

**Expected Result**: No TypeScript errors. If you see `Cannot find module 'aws-cdk-lib/aws-wafv2'`, run `npm install aws-cdk-lib` to ensure you have the latest version.

---

### Step 10.4: Redeploy FoundationStack with WAF

**What**: Push the WAF changes to AWS.

**Why**: The WAF WebACL needs to exist in AWS before ApiStack can reference its ARN.

**How**:
```bash
npx cdk deploy event-ticketing-v2-foundation-dev
```

**What happens**:
1. CDK detects the new WAF WebACL resource
2. CloudFormation creates the WebACL with all 3 rules
3. Takes about 2-3 minutes

**Expected Result**:
```
✅  event-ticketing-v2-foundation-dev

Outputs:
event-ticketing-v2-foundation-dev.DatabaseKeyArn = arn:aws:kms:us-east-1:...
event-ticketing-v2-foundation-dev.StorageKeyArn = arn:aws:kms:us-east-1:...
event-ticketing-v2-foundation-dev.WebAclArn = arn:aws:wafv2:us-east-1:690081480550:regional/webacl/...
```

**Save the WebAclArn** — you'll need it in Phase 3 when building the ApiStack.

---

### Step 10.5: Verify WAF in AWS Console

**What**: Confirm the WAF WebACL was created correctly.

**How**:
1. Go to AWS Console → search "WAF & Shield"
2. Click "Web ACLs" in left sidebar
3. Make sure the region dropdown (top-right) shows **US East (N. Virginia)**
4. You should see `event-ticketing-v2-waf-dev`
5. Click on it → check the "Rules" tab
6. You should see 3 rules:
   - `AWSManagedRulesCommonRuleSet`
   - `AWSManagedRulesKnownBadInputsRuleSet`
   - `RateLimitRule`
7. Click "Associated AWS resources" tab — it will be empty for now (we'll attach it to API Gateway in Phase 3)

**Expected Result**: WebACL exists with 3 rules, CloudWatch metrics enabled

---

## Part 6: Deploy All Remaining Stacks (Day 9)

### Step 11.1: Deploy Everything Together

**What**: Deploy AuthStack, DatabaseStack, StorageStack, MessagingStack, and then redeploy FoundationStack with WAF.

**Why this order matters**:
- FoundationStack is already deployed in AWS (from Phase 1) with the 2 KMS keys
- Auth, Database, Storage, and Messaging do NOT depend on the WAF — they only need the KMS keys which are already live
- So we deploy those 4 stacks first, then redeploy FoundationStack last to add the WAF
- This way if anything goes wrong with the WAF addition, the other 4 stacks are already safely deployed

**Important note about FoundationStack redeployment**:
When you redeploy FoundationStack with WAF, CDK will show a security confirmation prompt because it's adding IAM/security-related resources. Type `y` to confirm. The existing KMS keys will NOT be touched — CDK only adds the new WAF WebACL resource.

**How** (deploy one at a time — recommended for first time, easier to spot issues):

```bash
# Step 1: Auth (Cognito) — ~2-3 minutes
npx cdk deploy event-ticketing-v2-auth-dev

# Step 2: Database (DynamoDB) — ~3-5 minutes
npx cdk deploy event-ticketing-v2-database-dev

# Step 3: Storage (S3) — ~1-2 minutes
npx cdk deploy event-ticketing-v2-storage-dev

# Step 4: Messaging (SQS + EventBridge) — ~1-2 minutes
npx cdk deploy event-ticketing-v2-messaging-dev

# Step 5: Foundation (adds WAF to existing stack) — ~2-3 minutes
# NOTE: Deploy this LAST — the 4 stacks above don't need WAF to exist yet
npx cdk deploy event-ticketing-v2-foundation-dev
```

**Why task 7.6 (Identity Pool) is intentionally skipped**:
tasks.md lists "Create Identity Pool for AWS resource access" (task 7.6). We are NOT implementing this. Identity Pool is for giving browser apps direct access to AWS services (like S3). In our architecture, all AWS access goes through Lambda functions — the browser never talks to AWS directly. So Identity Pool is unnecessary and would add cost and complexity for no benefit.

**What happens for each**:

`auth-dev` (2-3 minutes):
- Creates Cognito User Pool
- Creates web client
- Creates Organizers and Attendees groups
- Stores IDs in SSM Parameter Store

`database-dev` (3-5 minutes):
- Creates Events table with 4 GSIs
- Creates Registrations table with 3 GSIs
- Creates Tickets table with 3 GSIs
- Enables encryption, PITR, and streams

`storage-dev` (1-2 minutes):
- Creates tickets S3 bucket with KMS encryption
- Creates frontend S3 bucket
- Configures lifecycle rules

`messaging-dev` (1-2 minutes):
- Creates DLQ (FIFO)
- Creates ticket generation queue (FIFO)
- Creates EventBridge custom event bus

`foundation-dev` (2-3 minutes):
- Adds WAF WebACL with 3 rules to the existing stack
- Does NOT change or delete the existing KMS keys
- CDK will ask for confirmation — type `y`

**Expected Result** (all 5 deploys):
```
✅  event-ticketing-v2-auth-dev
✅  event-ticketing-v2-database-dev
✅  event-ticketing-v2-storage-dev
✅  event-ticketing-v2-messaging-dev
✅  event-ticketing-v2-foundation-dev
```

---

### Step 11.2: Verify All Stacks in AWS Console

**What**: Quick sanity check that everything was created.

**How**:

Go to **CloudFormation** → you should see these stacks with `CREATE_COMPLETE` or `UPDATE_COMPLETE` status:
- `event-ticketing-v2-foundation-dev` ✅ (UPDATE_COMPLETE — WAF added)
- `event-ticketing-v2-auth-dev` ✅ (CREATE_COMPLETE)
- `event-ticketing-v2-database-dev` ✅ (CREATE_COMPLETE)
- `event-ticketing-v2-storage-dev` ✅ (CREATE_COMPLETE)
- `event-ticketing-v2-messaging-dev` ✅ (CREATE_COMPLETE)

Go to **Cognito** → User pools → `event-ticketing-v2-users-dev` ✅

Go to **DynamoDB** → Tables → you should see 3 tables ✅

Go to **S3** → you should see 2 new buckets ✅

Go to **SQS** → you should see 2 queues (main + DLQ) ✅

Go to **EventBridge** → Event buses → `event-ticketing-v2-events-dev` ✅

---

### Step 11.3: Commit and Push to GitHub

**What**: Save all Phase 2 changes to Git.

**Why**: Version control — always commit after a successful deployment.

**How**:
```bash
# Check what changed
git status

# Add all changes
git add .

# Commit with a descriptive message
git commit -m "feat: Phase 2 complete - Auth, Database, Storage, Messaging, WAF deployed"

# Push to GitHub
git push origin main
```

**Expected Result**: Code pushed to GitHub. You can verify at `https://github.com/Anshuman-git-code/event-ticketing-v2`

---

## Phase 2 Complete!

### What You've Accomplished

✅ **AuthStack deployed**:
- Cognito User Pool with email sign-in
- Password policy enforced
- Organizers and Attendees groups created
- User Pool ID and Client ID stored in SSM Parameter Store

✅ **DatabaseStack deployed**:
- 3 DynamoDB tables (Events, Registrations, Tickets)
- 10 GSIs for efficient querying
- KMS encryption, PITR, and DynamoDB Streams enabled on all tables

✅ **StorageStack deployed**:
- Tickets S3 bucket (private, KMS encrypted, versioned)
- Frontend S3 bucket (private, ready for CloudFront)
- Lifecycle rules configured

✅ **MessagingStack deployed**:
- SQS FIFO queue for async ticket generation
- Dead Letter Queue for failed messages
- EventBridge custom event bus

✅ **WAF deployed**:
- WebACL with CommonRuleSet, KnownBadInputsRuleSet, and rate limiting
- Ready to attach to API Gateway in Phase 3

### Current AWS Cost Estimate

After Phase 2, your monthly costs should be approximately:

| Service | Cost |
|---------|------|
| KMS keys (2) | ~$2 |
| GuardDuty | ~$5 |
| CloudTrail | ~$2 |
| AWS Config | ~$2 |
| Cognito (free tier: 50,000 MAU) | $0 |
| DynamoDB (on-demand, no traffic) | $0 |
| S3 (empty buckets) | ~$0.01 |
| SQS (no messages) | $0 |
| WAF WebACL | ~$5 |
| **Total** | **~$16/month** |

Still well under the $25 budget alert.

### Next Steps

**Week 3 (Phase 3)**: Build all Lambda functions:
- `createEvent`, `listEvents`, `getEvent`, `updateEvent`, `deleteEvent`
- `createRegistration` (with Stripe payment integration)
- `getMyRegistrations`, `getEventRegistrations`
- `generateTicket` (async, triggered by SQS)
- `getTicketDownload`, `validateTicket`
- Wire everything together in ApiStack

---

## Troubleshooting Common Phase 2 Issues

**Issue**: `cdk deploy` fails with "Unable to resolve AWS account"
**Solution**: Run `aws sts get-caller-identity` to verify credentials. If it fails, run `aws configure` again.

**Issue**: AuthStack deploy fails with "User pool already exists"
**Solution**: The User Pool name must be unique. Check if a pool with the same name exists in Cognito console. If so, either delete it or change the `userPoolName` in `auth-stack.ts`.

**Issue**: DatabaseStack deploy fails with "Table already exists"
**Solution**: Check DynamoDB console for existing tables with the same name. Delete them or change the table names in `database-stack.ts`.

**Issue**: StorageStack deploy fails with "Bucket name already exists"
**Solution**: S3 bucket names are globally unique. The account ID suffix should prevent this, but if it happens, add a random suffix to the bucket name.

**Issue**: WAF deploy fails with "WAF WebACL with this name already exists"
**Solution**: Go to WAF console → Web ACLs → delete the existing one, then redeploy.

**Issue**: `npm run build` shows TypeScript errors after adding WAF
**Solution**: Make sure you added `import * as wafv2 from 'aws-cdk-lib/aws-wafv2';` at the top of `foundation-stack.ts`.

**Issue**: Deploy shows "current credentials could not be used to assume role" warnings
**Solution**: These warnings are normal if you're using direct IAM credentials instead of CDK bootstrap roles. The deployment still succeeds — you can safely ignore them.

**Issue**: Cognito User Pool shows "FORCE_CHANGE_PASSWORD" for test users
**Solution**: This is normal for admin-created users. The user must change their password on first login. Use the AWS CLI to set a permanent password:
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com \
  --password "NewPassword123!" \
  --permanent \
  --region us-east-1
```

---

## Resources

- [Cognito User Pools Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [AWS WAF Developer Guide](https://docs.aws.amazon.com/waf/latest/developerguide/)
- [SQS FIFO Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)
- [CDK WAF Construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_wafv2-readme.html)

---

**Ready for Phase 3?** Once all Phase 2 stacks are deployed and verified, we'll move on to building the Lambda functions!
