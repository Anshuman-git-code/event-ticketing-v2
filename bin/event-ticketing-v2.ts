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

// Read environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') ?? 'dev';
const projectName = 'event-ticketing-v2';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const commonProps = { environment, projectName, env };

// ==========================================
// Stack 1: Foundation (KMS keys)
// No dependencies
// ==========================================
const foundationStack = new FoundationStack(
  app,
  `${projectName}-foundation-${environment}`,
  commonProps
);

// ==========================================
// Stack 2: Auth (Cognito)
// No dependencies on other stacks
// ==========================================
const authStack = new AuthStack(
  app,
  `${projectName}-auth-${environment}`,
  commonProps
);
authStack.addDependency(foundationStack);

// ==========================================
// Stack 3: Database (DynamoDB)
// Depends on: FoundationStack (KMS key)
// ==========================================
const databaseStack = new DatabaseStack(
  app,
  `${projectName}-database-${environment}`,
  {
    ...commonProps,
    databaseEncryptionKey: foundationStack.databaseEncryptionKey,
  }
);
databaseStack.addDependency(foundationStack);

// ==========================================
// Stack 4: Storage (S3 buckets)
// Depends on: FoundationStack (KMS key)
// ==========================================
const storageStack = new StorageStack(
  app,
  `${projectName}-storage-${environment}`,
  {
    ...commonProps,
    storageEncryptionKey: foundationStack.storageEncryptionKey,
  }
);
storageStack.addDependency(foundationStack);

// ==========================================
// Stack 5: Messaging (SQS + EventBridge)
// No KMS dependency (uses AWS-managed keys for now)
// ==========================================
const messagingStack = new MessagingStack(
  app,
  `${projectName}-messaging-${environment}`,
  commonProps
);

// ==========================================
// Stack 6: API (HTTP API Gateway + Lambda functions)
// Depends on: Auth, Database, Storage, Messaging, Foundation
// ==========================================
const apiStack = new ApiStack(
  app,
  `${projectName}-api-${environment}`,
  {
    ...commonProps,
    // From DatabaseStack
    eventsTable: databaseStack.eventsTable,
    registrationsTable: databaseStack.registrationsTable,
    ticketsTable: databaseStack.ticketsTable,
    // From StorageStack
    ticketsBucket: storageStack.ticketsBucket,
    // From MessagingStack
    ticketGenerationQueue: messagingStack.ticketGenerationQueue,
    // From AuthStack
    userPool: authStack.userPool,
    userPoolClient: authStack.userPoolClient,
    // From FoundationStack
    webAcl: foundationStack.webAcl,
  }
);
apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
apiStack.addDependency(messagingStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(foundationStack);

// ==========================================
// Stack 7: Observability (CloudWatch)
// Depends on all other stacks (monitors them)
// ==========================================
const observabilityStack = new ObservabilityStack(
  app,
  `${projectName}-observability-${environment}`,
  {
    ...commonProps,
    alarmEmail: 'anshuman.mohapatra04@gmail.com',
  }
);
observabilityStack.addDependency(apiStack);

// Suppress unused variable warnings - stacks are registered with the app
void authStack;
void databaseStack;
void storageStack;
void messagingStack;
void apiStack;
void observabilityStack;
