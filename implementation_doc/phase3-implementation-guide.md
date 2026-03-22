# Phase 3 Implementation Guide: Lambda Functions & API

## Overview

This guide provides step-by-step instructions for Phase 3 (Week 3) of the Event Ticketing System V2 project.

**Duration**: Week 3 (5-7 days)
**Goal**: Build all 10 Lambda functions, wire them into the ApiStack, and deploy a fully working API

**What Phase 2 gave us**:
- ✅ Cognito User Pool (auth-dev) — JWT tokens for authentication
- ✅ DynamoDB tables (database-dev) — Events, Registrations, Tickets
- ✅ S3 buckets (storage-dev) — Tickets PDF storage
- ✅ SQS FIFO queue (messaging-dev) — Async ticket generation
- ✅ WAF WebACL (foundation-dev) — API protection

**What Phase 3 will give us**:
- 10 Lambda functions (all application logic)
- HTTP API Gateway with Cognito JWT authorizer
- WAF attached to API Gateway
- A fully working REST API you can test with curl or Postman

---

## Understanding the Architecture Before You Code

### How a Request Flows Through the System

```
Browser/Postman
    │
    ▼
API Gateway (HTTP API v2)
    │  ← WAF checks every request (blocks attacks, rate limits)
    │  ← JWT Authorizer validates Cognito token (for protected routes)
    ▼
Lambda Function
    │  ← Reads/writes DynamoDB
    │  ← Sends to SQS (for ticket generation)
    │  ← Reads/writes S3 (for ticket PDFs)
    ▼
Response back to browser
```

### What Lambda Powertools Does For You

Every Lambda function uses three tools from Lambda Powertools:

- **Logger**: Structured JSON logs (instead of `console.log`) — searchable in CloudWatch
- **Tracer**: X-Ray distributed tracing — see exactly where time is spent
- **Metrics**: Custom CloudWatch metrics — track business events like "registrations per hour"

You'll see these in every function. Once you understand the pattern in the first function, the rest are the same.

### What Zod Does

Zod validates the request body. Instead of manually checking `if (!body.name) return 400`, you define a schema and Zod checks everything at once. If validation fails, it returns a clear error message.

---

## Part 1: Install Phase 3 Dependencies (Day 10)

### Step 12.1: Install Required Libraries

**What**: Install the npm packages needed for Lambda functions.

**Why**: We need PDF generation (pdfkit), QR code generation (qrcode), and Stripe for payments.

**How**:
```bash

npm install zod

# PDF generation for tickets
npm install pdfkit
npm install @types/pdfkit --save-dev

# QR code generation
npm install qrcode
npm install @types/qrcode --save-dev

# Stripe payment processing
npm install stripe

# AWS SDK clients (may already be installed, run anyway)
npm install @aws-sdk/client-dynamodb
npm install @aws-sdk/lib-dynamodb
npm install @aws-sdk/client-s3
npm install @aws-sdk/client-sqs
npm install @aws-sdk/client-ses
npm install @aws-sdk/client-secrets-manager
npm install @aws-sdk/s3-request-presigner
```

**Expected Result**: All packages installed, no errors.

**Verify**:
```bash
npm list pdfkit qrcode stripe
# Should show version numbers for all three
```

---

### Step 12.2: Create Lambda Folder Structure

**What**: Create the directory for each Lambda function.

**Why**: Each Lambda function lives in its own folder with its own `index.ts` file.

**How**:
```bash
mkdir -p lambda/createEvent
mkdir -p lambda/listEvents
mkdir -p lambda/getEvent
mkdir -p lambda/updateEvent
mkdir -p lambda/deleteEvent
mkdir -p lambda/createRegistration
mkdir -p lambda/getMyRegistrations
mkdir -p lambda/getEventRegistrations
mkdir -p lambda/generateTicket
mkdir -p lambda/getTicketDownload
mkdir -p lambda/validateTicket
```

**Expected Result**: 11 empty folders inside `lambda/`

---

### Step 12.3: Create a Shared Types File

**What**: A shared TypeScript file with types used across all Lambda functions.

**Why**: Avoids repeating the same type definitions in every function.

**How**: Create `lambda/types.ts`:

```typescript
// Shared types used across all Lambda functions

export interface Event {
  eventId: string;
  organizerId: string;
  name: string;
  description: string;
  date: string;           // ISO8601
  location: string;
  capacity: number;
  availableCapacity: number;
  price: number;          // USD cents (e.g., 2500 = $25.00)
  category: string;       // "conference" | "concert" | "workshop" | "sports" | "other"
  status: string;         // "active" | "sold_out" | "cancelled"
  createdAt: string;
  updatedAt: string;
}

export interface Registration {
  registrationId: string;
  eventId: string;
  userId: string;
  userName: string;
  userEmail: string;
  registeredAt: string;
  paymentStatus: string;  // "pending" | "confirmed" | "failed"
  amount: number;
  ticketId?: string;
  idempotencyKey: string;
}

export interface Ticket {
  ticketId: string;
  registrationId: string;
  eventId: string;
  userId: string;
  qrCode: string;
  status: string;         // "generated" | "validated"
  generatedAt: string;
  validatedAt?: string;
  s3Key: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  attendeeName: string;
}

// Standard API error response
export interface ApiError {
  error: {
    code: string;
    message: string;
    correlationId?: string;
  };
}

// Helper to build a success response
export function successResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Helper to build an error response
export function errorResponse(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code, message } }),
  };
}
```

**Expected Result**: File created at `lambda/types.ts`

---

## Part 2: Event Management Lambda Functions (Day 10-11)

### Step 13: Lambda Function — createEvent

#### Step 13.1: Understand What It Does

**What**: Creates a new event in DynamoDB when an organizer submits event details.

**Why**: This is the first write operation in the system. An organizer fills out a form (name, date, location, capacity, price) and this Lambda saves it.

**How it works**:
1. API Gateway receives `POST /v1/events`
2. JWT authorizer validates the Cognito token
3. Lambda extracts the organizer's ID from the token (`event.requestContext.authorizer.jwt.claims.sub`)
4. Zod validates the request body
5. Lambda writes the event to DynamoDB
6. Returns the created event with a 201 status

#### Step 13.2: Create the Function

Create `lambda/createEvent/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { successResponse, errorResponse } from '../types';

// Lambda Powertools setup — these read from environment variables set by CDK
const logger = new Logger({ serviceName: 'createEvent' });
const tracer = new Tracer({ serviceName: 'createEvent' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'createEvent' });

// DynamoDB client — created once outside handler (reused across warm invocations)
const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

// Zod schema — defines what a valid request body looks like
const CreateEventSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  date: z.string().datetime({ message: 'date must be ISO8601 format' }),
  location: z.string().min(1).max(500),
  capacity: z.number().int().positive().max(100000),
  price: z.number().int().min(0),  // USD cents, 0 = free
  category: z.enum(['conference', 'concert', 'workshop', 'sports', 'other']),
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  // Add correlation ID to all log messages
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    // 1. Extract organizer identity from JWT token
    const claims = event.requestContext.authorizer.jwt.claims;
    const organizerId = claims.sub as string;
    const organizerEmail = claims.email as string;

    logger.info('Creating event', { organizerId });

    // 2. Parse and validate request body
    if (!event.body) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
    }

    const parseResult = CreateEventSchema.safeParse(JSON.parse(event.body));
    if (!parseResult.success) {
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.errors[0].message);
    }

    const input = parseResult.data;

    // 3. Validate event date is in the future
    if (new Date(input.date) <= new Date()) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Event date must be in the future');
    }

    // 4. Build the event item
    const now = new Date().toISOString();
    const eventItem = {
      eventId: randomUUID(),
      organizerId,
      organizerEmail,
      ...input,
      availableCapacity: input.capacity,  // starts equal to capacity
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // 5. Write to DynamoDB
    await ddbClient.send(new PutCommand({
      TableName: process.env.EVENTS_TABLE!,
      Item: eventItem,
    }));

    // 6. Record business metric
    metrics.addMetric('EventCreated', MetricUnit.Count, 1);

    logger.info('Event created successfully', { eventId: eventItem.eventId });

    return successResponse(201, eventItem);

  } catch (error) {
    logger.error('Failed to create event', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to create event');
  } finally {
    // Always publish metrics at end of handler
    metrics.publishStoredMetrics();
  }
};
```

**What each section does**:
- `Logger/Tracer/Metrics` — Lambda Powertools setup. These read `POWERTOOLS_SERVICE_NAME` env var set by CDK.
- `tracer.captureAWSv3Client(...)` — wraps DynamoDB client so X-Ray traces every DynamoDB call
- `CreateEventSchema` — Zod schema. `safeParse` returns `{ success: true, data }` or `{ success: false, error }`
- `claims.sub` — the Cognito user's unique ID (UUID format). This is the organizer's identity.
- `randomUUID()` — Node.js built-in UUID generator (no external library needed)
- `process.env.EVENTS_TABLE!` — table name injected by CDK as environment variable

---

### Step 14: Lambda Function — listEvents

#### Step 14.1: Understand What It Does

**What**: Returns a paginated list of active events. This is a PUBLIC endpoint — no login required.

**Why**: Attendees need to browse events without creating an account first.

**Note on ElastiCache**: tasks.md mentions ElastiCache caching for this function. We are skipping ElastiCache in Phase 3 — it requires a VPC and adds significant cost (~$30/month). We'll query DynamoDB directly. The caching layer can be added later as an optimization.

**How it works**:
1. API Gateway receives `GET /v1/events`
2. No JWT check (public route)
3. Lambda queries DynamoDB `DateIndex` GSI (partition key = `status`, sort key = `date`)
4. Returns paginated results

#### Step 14.2: Create the Function

Create `lambda/listEvents/index.ts`:

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'listEvents' });
const tracer = new Tracer({ serviceName: 'listEvents' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit || '20'), 100);
    const nextToken = queryParams.nextToken;

    // Decode pagination token if provided
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      } catch {
        return errorResponse(400, 'VALIDATION_ERROR', 'Invalid nextToken');
      }
    }

    // Query DateIndex GSI — get all "active" events sorted by date
    const result = await ddbClient.send(new QueryCommand({
      TableName: process.env.EVENTS_TABLE!,
      IndexName: 'DateIndex',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'active' },
      ScanIndexForward: true,   // ascending date order (soonest first)
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    // Encode next page token
    const responseNextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    logger.info('Listed events', { count: result.Items?.length });

    return successResponse(200, {
      events: result.Items || [],
      nextToken: responseNextToken,
      count: result.Items?.length || 0,
    });

  } catch (error) {
    logger.error('Failed to list events', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to list events');
  }
};
```

**Key concepts**:
- `QueryCommand` with `IndexName: 'DateIndex'` — queries the GSI, not the main table
- `ScanIndexForward: true` — returns results in ascending sort key order (earliest date first)
- Pagination: DynamoDB returns `LastEvaluatedKey` when there are more results. We base64-encode it and return it as `nextToken`. The client sends it back on the next request.
- `ExpressionAttributeNames: { '#status': 'status' }` — `status` is a reserved word in DynamoDB, so we alias it with `#status`

---

### Step 15: Lambda Function — getEvent

#### Step 15.1: Understand What It Does

**What**: Returns a single event by its ID. Also PUBLIC — no login required.

**How it works**:
1. API Gateway receives `GET /v1/events/{eventId}`
2. Lambda does a `GetItem` on the Events table
3. Returns 404 if not found, 200 with event data if found

#### Step 15.2: Create the Function

Create `lambda/getEvent/index.ts`:

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'getEvent' });
const tracer = new Tracer({ serviceName: 'getEvent' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) {
      return errorResponse(400, 'VALIDATION_ERROR', 'eventId is required');
    }

    const result = await ddbClient.send(new GetCommand({
      TableName: process.env.EVENTS_TABLE!,
      Key: { eventId },
    }));

    if (!result.Item) {
      return errorResponse(404, 'NOT_FOUND', `Event ${eventId} not found`);
    }

    logger.info('Got event', { eventId });
    return successResponse(200, result.Item);

  } catch (error) {
    logger.error('Failed to get event', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to get event');
  }
};
```

---

### Step 16: Lambda Function — updateEvent

#### Step 16.1: Understand What It Does

**What**: Updates an existing event. Only the organizer who created it can update it.

**Key concept — Condition Expressions**: DynamoDB `UpdateItem` supports a `ConditionExpression`. We use `organizerId = :organizerId` to ensure only the owner can update. If the condition fails, DynamoDB throws `ConditionalCheckFailedException` — we catch that and return 403.

#### Step 16.2: Create the Function

Create `lambda/updateEvent/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'updateEvent' });
const tracer = new Tracer({ serviceName: 'updateEvent' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

const UpdateEventSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  date: z.string().datetime().optional(),
  location: z.string().min(1).max(500).optional(),
  capacity: z.number().int().positive().optional(),
  price: z.number().int().min(0).optional(),
  category: z.enum(['conference', 'concert', 'workshop', 'sports', 'other']).optional(),
  status: z.enum(['active', 'cancelled']).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return errorResponse(400, 'VALIDATION_ERROR', 'eventId is required');

    const organizerId = event.requestContext.authorizer.jwt.claims.sub as string;

    if (!event.body) return errorResponse(400, 'VALIDATION_ERROR', 'Request body is required');

    const parseResult = UpdateEventSchema.safeParse(JSON.parse(event.body));
    if (!parseResult.success) {
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.errors[0].message);
    }

    const updates = parseResult.data;

    // Build dynamic UpdateExpression from provided fields
    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const expressionAttributeValues: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
      ':organizerId': organizerId,  // for condition check
    };

    Object.entries(updates).forEach(([key, value]) => {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    });

    await ddbClient.send(new UpdateCommand({
      TableName: process.env.EVENTS_TABLE!,
      Key: { eventId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      // Condition: only update if this organizer owns the event
      ConditionExpression: 'organizerId = :organizerId',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }));

    logger.info('Event updated', { eventId, organizerId });
    return successResponse(200, { message: 'Event updated successfully', eventId });

  } catch (error: unknown) {
    // DynamoDB throws this when condition expression fails
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return errorResponse(403, 'FORBIDDEN', 'You do not own this event');
    }
    logger.error('Failed to update event', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to update event');
  }
};
```

---

### Step 17: Lambda Function — deleteEvent

#### Step 17.1: Understand What It Does

**What**: Deletes an event. Only the owner can delete it, and only if no registrations exist.

**Why check registrations first?** If people have already registered and paid, you can't just delete the event — they'd lose their tickets. We query the Registrations table first and block deletion if any exist.

#### Step 17.2: Create the Function

Create `lambda/deleteEvent/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'deleteEvent' });
const tracer = new Tracer({ serviceName: 'deleteEvent' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return errorResponse(400, 'VALIDATION_ERROR', 'eventId is required');

    const organizerId = event.requestContext.authorizer.jwt.claims.sub as string;

    // Check if any registrations exist for this event
    const registrations = await ddbClient.send(new QueryCommand({
      TableName: process.env.REGISTRATIONS_TABLE!,
      IndexName: 'EventIndex',
      KeyConditionExpression: 'eventId = :eventId',
      ExpressionAttributeValues: { ':eventId': eventId },
      Limit: 1,  // We only need to know if ANY exist
    }));

    if (registrations.Items && registrations.Items.length > 0) {
      return errorResponse(409, 'CONFLICT', 'Cannot delete event with existing registrations');
    }

    // Delete with ownership check
    await ddbClient.send(new DeleteCommand({
      TableName: process.env.EVENTS_TABLE!,
      Key: { eventId },
      ConditionExpression: 'organizerId = :organizerId',
      ExpressionAttributeValues: { ':organizerId': organizerId },
    }));

    logger.info('Event deleted', { eventId, organizerId });
    return successResponse(200, { message: 'Event deleted successfully' });

  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return errorResponse(403, 'FORBIDDEN', 'You do not own this event');
    }
    logger.error('Failed to delete event', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to delete event');
  }
};
```

---

## Part 3: Registration Lambda Functions (Day 12)

### Step 18: Lambda Function — createRegistration

#### Step 18.1: Understand What It Does

**What**: Registers an attendee for an event. This is the most complex Lambda in the system.

**Why it's complex**:
1. Must check event capacity (race condition risk — two people registering at the same time)
2. Must be idempotent (if the client retries, don't create two registrations)
3. Must send a message to SQS to trigger async ticket generation

**What is idempotency?**
If a user clicks "Register" and their internet drops before they get a response, they might click again. Without idempotency, they'd get two registrations and be charged twice. With idempotency:
- Client sends a unique `X-Idempotency-Key` header (a UUID they generate)
- If we've seen this key before, we return the original response instead of creating a new registration

**How capacity is protected**:
We use a DynamoDB `ConditionExpression` on the UpdateItem call:
```
availableCapacity > 0
```
If two people register simultaneously, only one will succeed — the other gets `ConditionalCheckFailedException`.

**Note on Stripe**: For now we implement a simplified version without real Stripe integration. The Stripe call is marked with a TODO comment. You'll add real Stripe in Phase 6.

#### Step 18.2: Create the Function

Create `lambda/createRegistration/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'createRegistration' });
const tracer = new Tracer({ serviceName: 'createRegistration' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'createRegistration' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));

const CreateRegistrationSchema = z.object({
  eventId: z.string().uuid(),
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    // 1. Get idempotency key from header (required)
    const idempotencyKey = event.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return errorResponse(400, 'VALIDATION_ERROR', 'X-Idempotency-Key header is required');
    }

    // 2. Extract user identity from JWT
    const claims = event.requestContext.authorizer.jwt.claims;
    const userId = claims.sub as string;
    const userEmail = claims.email as string;
    const userName = (claims.name as string) || userEmail;

    // 3. Validate request body
    if (!event.body) return errorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
    const parseResult = CreateRegistrationSchema.safeParse(JSON.parse(event.body));
    if (!parseResult.success) {
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.errors[0].message);
    }
    const { eventId } = parseResult.data;

    // 4. Check idempotency — has this key been used before?
    const existingReg = await ddbClient.send(new QueryCommand({
      TableName: process.env.REGISTRATIONS_TABLE!,
      IndexName: 'IdempotencyIndex',
      KeyConditionExpression: 'idempotencyKey = :key',
      ExpressionAttributeValues: { ':key': idempotencyKey },
      Limit: 1,
    }));

    if (existingReg.Items && existingReg.Items.length > 0) {
      // Return the original registration (idempotent response)
      logger.info('Returning existing registration (idempotent)', { idempotencyKey });
      return successResponse(200, existingReg.Items[0]);
    }

    // 5. Get event details and check it exists
    const eventResult = await ddbClient.send(new GetCommand({
      TableName: process.env.EVENTS_TABLE!,
      Key: { eventId },
    }));

    if (!eventResult.Item) {
      return errorResponse(404, 'NOT_FOUND', 'Event not found');
    }

    const eventData = eventResult.Item;

    if (eventData.status !== 'active') {
      return errorResponse(409, 'CONFLICT', 'Event is not accepting registrations');
    }

    if (eventData.availableCapacity <= 0) {
      return errorResponse(409, 'CONFLICT', 'Event is sold out');
    }

    // 6. TODO: Stripe payment processing
    // In Phase 6, add real Stripe integration here:
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // const paymentIntent = await stripe.paymentIntents.create({...});
    // For now, we simulate a successful payment:
    const paymentIntentId = `pi_simulated_${randomUUID()}`;

    // 7. Create registration record
    const now = new Date().toISOString();
    const registrationId = randomUUID();
    const registration = {
      registrationId,
      eventId,
      userId,
      userName,
      userEmail,
      registeredAt: now,
      paymentStatus: 'confirmed',
      paymentIntentId,
      amount: eventData.price,
      idempotencyKey,
    };

    await ddbClient.send(new PutCommand({
      TableName: process.env.REGISTRATIONS_TABLE!,
      Item: registration,
      // Prevent duplicate if somehow called twice simultaneously
      ConditionExpression: 'attribute_not_exists(registrationId)',
    }));

    // 8. Atomically decrement event capacity
    // ConditionExpression ensures we don't go below 0
    try {
      await ddbClient.send(new UpdateCommand({
        TableName: process.env.EVENTS_TABLE!,
        Key: { eventId },
        UpdateExpression: 'SET availableCapacity = availableCapacity - :one, #updatedAt = :now',
        ConditionExpression: 'availableCapacity > :zero',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': now },
      }));
    } catch (capacityError: unknown) {
      if ((capacityError as { name?: string }).name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'CONFLICT', 'Event just sold out');
      }
      throw capacityError;
    }

    // 9. Send message to SQS for async ticket generation
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.TICKET_QUEUE_URL!,
      MessageBody: JSON.stringify({
        registrationId,
        eventId,
        userId,
        userName,
        userEmail,
        eventName: eventData.name,
        eventDate: eventData.date,
        eventLocation: eventData.location,
        amount: eventData.price,
        timestamp: now,
      }),
      MessageGroupId: eventId,           // Group by event for ordered processing
      MessageDeduplicationId: registrationId,  // Prevent duplicate messages
    }));

    metrics.addMetric('RegistrationCreated', MetricUnit.Count, 1);
    logger.info('Registration created', { registrationId, eventId, userId });

    // 10. Return 201 immediately — ticket generation happens in background
    return successResponse(201, {
      ...registration,
      message: 'Registration successful. Your ticket will be emailed shortly.',
    });

  } catch (error) {
    logger.error('Failed to create registration', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to create registration');
  } finally {
    metrics.publishStoredMetrics();
  }
};
```

---

### Step 19: Lambda Function — getMyRegistrations

#### Step 19.1: Understand What It Does

**What**: Returns all registrations for the currently logged-in user. Uses the `UserIndex` GSI on the Registrations table.

#### Step 19.2: Create the Function

Create `lambda/getMyRegistrations/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'getMyRegistrations' });
const tracer = new Tracer({ serviceName: 'getMyRegistrations' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const userId = event.requestContext.authorizer.jwt.claims.sub as string;
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit || '20'), 100);

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (queryParams.nextToken) {
      exclusiveStartKey = JSON.parse(Buffer.from(queryParams.nextToken, 'base64').toString());
    }

    const result = await ddbClient.send(new QueryCommand({
      TableName: process.env.REGISTRATIONS_TABLE!,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,  // Most recent first
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    const nextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    logger.info('Listed registrations', { userId, count: result.Items?.length });

    return successResponse(200, {
      registrations: result.Items || [],
      nextToken,
      count: result.Items?.length || 0,
    });

  } catch (error) {
    logger.error('Failed to get registrations', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to get registrations');
  }
};
```

---

### Step 20: Lambda Function — getEventRegistrations

#### Step 20.1: Understand What It Does

**What**: Returns all registrations for a specific event. Only the event organizer can call this.

**Why**: Organizers need to see who registered for their event (attendee list).

**Authorization check**: We fetch the event first and verify `organizerId` matches the caller's JWT `sub`.

#### Step 20.2: Create the Function

Create `lambda/getEventRegistrations/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'getEventRegistrations' });
const tracer = new Tracer({ serviceName: 'getEventRegistrations' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return errorResponse(400, 'VALIDATION_ERROR', 'eventId is required');

    const userId = event.requestContext.authorizer.jwt.claims.sub as string;

    // Verify caller is the organizer of this event
    const eventResult = await ddbClient.send(new GetCommand({
      TableName: process.env.EVENTS_TABLE!,
      Key: { eventId },
    }));

    if (!eventResult.Item) return errorResponse(404, 'NOT_FOUND', 'Event not found');
    if (eventResult.Item.organizerId !== userId) {
      return errorResponse(403, 'FORBIDDEN', 'Only the event organizer can view registrations');
    }

    // Query all registrations for this event
    const result = await ddbClient.send(new QueryCommand({
      TableName: process.env.REGISTRATIONS_TABLE!,
      IndexName: 'EventIndex',
      KeyConditionExpression: 'eventId = :eventId',
      ExpressionAttributeValues: { ':eventId': eventId },
      ScanIndexForward: false,
    }));

    logger.info('Listed event registrations', { eventId, count: result.Items?.length });

    return successResponse(200, {
      registrations: result.Items || [],
      count: result.Items?.length || 0,
      eventId,
    });

  } catch (error) {
    logger.error('Failed to get event registrations', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to get event registrations');
  }
};
```

---

## Part 4: Ticket Lambda Functions (Day 13)

### Step 21: Lambda Function — generateTicket (Async)

#### Step 21.1: Understand What It Does

**What**: This Lambda is NOT triggered by HTTP. It's triggered by SQS messages. When `createRegistration` sends a message to the SQS queue, this Lambda wakes up, generates a PDF ticket with a QR code, uploads it to S3, and saves the ticket record to DynamoDB.

**Why async?** PDF generation takes ~500-800ms. If we did this synchronously in `createRegistration`, the user would wait 1+ second for their registration to complete. By using SQS, the user gets a response in ~15ms and the ticket is generated in the background.

**What the PDF contains**:
- Event name, date, location
- Attendee name and email
- A QR code (encodes the ticketId as JSON)
- Ticket ID for reference

#### Step 21.2: Install PDF and QR dependencies (if not done)

```bash
npm install pdfkit qrcode
npm install @types/pdfkit @types/qrcode --save-dev
```

#### Step 21.3: Create the Function

Create `lambda/generateTicket/index.ts`:

```typescript
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const logger = new Logger({ serviceName: 'generateTicket' });
const tracer = new Tracer({ serviceName: 'generateTicket' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'generateTicket' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);
const s3Client = tracer.captureAWSv3Client(new S3Client({}));

// Process each SQS message
async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { registrationId, eventId, userId, userName, userEmail, eventName, eventDate, eventLocation } = message;

  logger.info('Processing ticket generation', { registrationId, eventId });

  // 1. Check if ticket already exists (idempotency)
  const existingTicket = await ddbClient.send(new GetCommand({
    TableName: process.env.TICKETS_TABLE!,
    Key: { ticketId: registrationId },  // Use registrationId as ticketId for idempotency
  }));

  if (existingTicket.Item) {
    logger.info('Ticket already exists, skipping', { registrationId });
    return;
  }

  // 2. Generate QR code as base64 PNG
  const qrPayload = JSON.stringify({
    ticketId: registrationId,
    eventId,
    userId,
    timestamp: new Date().toISOString(),
  });
  const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 200 });
  // Extract base64 data (remove "data:image/png;base64," prefix)
  const qrCodeBase64 = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');

  // 3. Generate PDF
  const pdfBuffer = await generatePDF({
    ticketId: registrationId,
    eventName,
    eventDate: new Date(eventDate).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    eventLocation,
    attendeeName: userName,
    attendeeEmail: userEmail,
    qrCodeBase64,
  });

  // 4. Upload PDF to S3
  const s3Key = `tickets/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${registrationId}.pdf`;

  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.TICKETS_BUCKET!,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    Metadata: {
      registrationId,
      eventId,
      userId,
    },
  }));

  // 5. Save ticket record to DynamoDB
  const now = new Date().toISOString();
  const ticketItem = {
    ticketId: registrationId,
    registrationId,
    eventId,
    userId,
    qrCode: qrCodeBase64,
    status: 'generated',
    generatedAt: now,
    s3Key,
    eventName,
    eventDate,
    eventLocation,
    attendeeName: userName,
  };

  await ddbClient.send(new PutCommand({
    TableName: process.env.TICKETS_TABLE!,
    Item: ticketItem,
    ConditionExpression: 'attribute_not_exists(ticketId)',
  }));

  // 6. Update registration with ticketId
  await ddbClient.send(new UpdateCommand({
    TableName: process.env.REGISTRATIONS_TABLE!,
    Key: { registrationId },
    UpdateExpression: 'SET ticketId = :ticketId, #updatedAt = :now',
    ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
    ExpressionAttributeValues: { ':ticketId': registrationId, ':now': now },
  }));

  metrics.addMetric('TicketGenerated', MetricUnit.Count, 1);
  logger.info('Ticket generated successfully', { registrationId, s3Key });
}

// Helper: Generate PDF buffer
async function generatePDF(data: {
  ticketId: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  attendeeName: string;
  attendeeEmail: string;
  qrCodeBase64: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold').text('EVENT TICKET', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Event details
    doc.fontSize(20).font('Helvetica-Bold').text(data.eventName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica').text(`Date: ${data.eventDate}`, { align: 'center' });
    doc.text(`Location: ${data.eventLocation}`, { align: 'center' });
    doc.moveDown(1.5);

    // Attendee details
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text('ATTENDEE');
    doc.font('Helvetica').text(data.attendeeName);
    doc.text(data.attendeeEmail);
    doc.moveDown(1);

    // QR Code
    const qrBuffer = Buffer.from(data.qrCodeBase64, 'base64');
    doc.image(qrBuffer, { fit: [150, 150], align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Ticket ID: ${data.ticketId}`, { align: 'center' });

    doc.end();
  });
}

// SQS handler — processes batch of messages
export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing SQS batch', { messageCount: event.Records.length });

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error('Failed to process record', { messageId: record.messageId, error });
      // Re-throw to let SQS retry this message (up to maxReceiveCount=3, then DLQ)
      throw error;
    }
  }

  metrics.publishStoredMetrics();
};
```

**Key things to understand**:
- The handler receives `SQSEvent` (not `APIGatewayProxyEvent`) — this Lambda is triggered by SQS, not HTTP
- We process records in a loop — SQS can batch multiple messages
- If any record throws, we re-throw so SQS retries that message
- After 3 retries, SQS sends the message to the DLQ (configured in MessagingStack)
- We use `registrationId` as the `ticketId` — this gives us natural idempotency

---

### Step 22: Lambda Function — getTicketDownload

#### Step 22.1: Understand What It Does

**What**: Returns a pre-signed S3 URL so the user can download their ticket PDF.

**Why pre-signed URLs?** The S3 bucket is private (no public access). A pre-signed URL is a temporary, time-limited URL that grants access to a specific S3 object without making the bucket public. It expires after 15 minutes.

**Authorization**: We verify the ticket belongs to the requesting user before generating the URL.

#### Step 22.2: Create the Function

Create `lambda/getTicketDownload/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'getTicketDownload' });
const tracer = new Tracer({ serviceName: 'getTicketDownload' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);
const s3Client = tracer.captureAWSv3Client(new S3Client({}));

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) return errorResponse(400, 'VALIDATION_ERROR', 'ticketId is required');

    const userId = event.requestContext.authorizer.jwt.claims.sub as string;

    // Fetch ticket from DynamoDB
    const result = await ddbClient.send(new GetCommand({
      TableName: process.env.TICKETS_TABLE!,
      Key: { ticketId },
    }));

    if (!result.Item) return errorResponse(404, 'NOT_FOUND', 'Ticket not found');

    // Verify ownership
    if (result.Item.userId !== userId) {
      return errorResponse(403, 'FORBIDDEN', 'This ticket does not belong to you');
    }

    // Generate pre-signed URL (valid for 15 minutes)
    const presignedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.TICKETS_BUCKET!,
        Key: result.Item.s3Key,
        ResponseContentDisposition: `attachment; filename="ticket-${ticketId}.pdf"`,
      }),
      { expiresIn: 900 }  // 15 minutes in seconds
    );

    logger.info('Generated download URL', { ticketId, userId });

    return successResponse(200, {
      downloadUrl: presignedUrl,
      expiresIn: 900,
      ticket: {
        ticketId: result.Item.ticketId,
        eventName: result.Item.eventName,
        eventDate: result.Item.eventDate,
        status: result.Item.status,
      },
    });

  } catch (error) {
    logger.error('Failed to get ticket download', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to generate download URL');
  }
};
```

---

### Step 23: Lambda Function — validateTicket

#### Step 23.1: Understand What It Does

**What**: Validates a QR code at event entry. The organizer scans a ticket's QR code, this Lambda checks if it's valid and marks it as used.

**Key concept — Conditional Update**: We use `ConditionExpression: '#status = :generated'` on the UpdateItem. This means:
- If ticket status is "generated" → update to "validated" ✅
- If ticket status is already "validated" → `ConditionalCheckFailedException` → return 409 (already used)

This prevents the same ticket from being scanned twice.

#### Step 23.2: Create the Function

Create `lambda/validateTicket/index.ts`:

```typescript
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'validateTicket' });
const tracer = new Tracer({ serviceName: 'validateTicket' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'validateTicket' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

const ValidateTicketSchema = z.object({
  qrCodeData: z.string().min(1),
  eventId: z.string().uuid(),
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    if (!event.body) return errorResponse(400, 'VALIDATION_ERROR', 'Request body is required');

    const parseResult = ValidateTicketSchema.safeParse(JSON.parse(event.body));
    if (!parseResult.success) {
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.errors[0].message);
    }

    const { qrCodeData, eventId } = parseResult.data;

    // 1. Decode QR code payload
    let qrPayload: { ticketId: string; eventId: string; userId: string };
    try {
      qrPayload = JSON.parse(qrCodeData);
    } catch {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid QR code format');
    }

    // 2. Fetch ticket from DynamoDB
    const ticketResult = await ddbClient.send(new GetCommand({
      TableName: process.env.TICKETS_TABLE!,
      Key: { ticketId: qrPayload.ticketId },
    }));

    if (!ticketResult.Item) {
      return errorResponse(404, 'NOT_FOUND', 'Ticket not found');
    }

    const ticket = ticketResult.Item;

    // 3. Verify ticket is for the correct event
    if (ticket.eventId !== eventId) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Ticket is for a different event');
    }

    // 4. Mark ticket as validated (conditional — fails if already validated)
    const now = new Date().toISOString();
    try {
      await ddbClient.send(new UpdateCommand({
        TableName: process.env.TICKETS_TABLE!,
        Key: { ticketId: qrPayload.ticketId },
        UpdateExpression: 'SET #status = :validated, validatedAt = :now',
        ConditionExpression: '#status = :generated',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':validated': 'validated',
          ':generated': 'generated',
          ':now': now,
        },
      }));
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'CONFLICT', 'Ticket has already been validated');
      }
      throw error;
    }

    metrics.addMetric('TicketValidated', MetricUnit.Count, 1);
    logger.info('Ticket validated', { ticketId: qrPayload.ticketId, eventId });

    return successResponse(200, {
      valid: true,
      ticketId: qrPayload.ticketId,
      attendeeName: ticket.attendeeName,
      eventName: ticket.eventName,
      validatedAt: now,
    });

  } catch (error) {
    logger.error('Failed to validate ticket', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to validate ticket');
  } finally {
    metrics.publishStoredMetrics();
  }
};
```


---

## Part 5: ApiStack Implementation (Day 14)

### Step 24: Update lib/stacks/api-stack.ts

#### Step 24.1: Understand What This File Does

**What**: The ApiStack is the "wiring" file. It:
1. Creates Lambda functions (pointing to your code in `lambda/`)
2. Creates a Cognito JWT authorizer (validates tokens automatically)
3. Creates HTTP routes and connects them to Lambda functions
4. Attaches the WAF WebACL to protect the API
5. Grants each Lambda the minimum IAM permissions it needs

**Why NodejsFunction?** CDK has a special construct called `NodejsFunction` (from `aws-cdk-lib/aws-lambda-nodejs`). It automatically bundles your TypeScript Lambda code using esbuild — no manual compilation needed. You just point it at your `index.ts` file and CDK handles the rest.

**Why does ApiStack need props from other stacks?** Each Lambda needs to know:
- Which DynamoDB table to write to (table name as env var)
- Which S3 bucket to use (bucket name as env var)
- Which SQS queue to send messages to (queue URL as env var)
- Which Cognito User Pool to validate tokens against (for the authorizer)

These values come from the other stacks as props.

#### Step 24.2: Update ApiStackProps Interface

First, update the props interface so ApiStack can receive resources from other stacks.

**What**: Add imports and a new props interface that accepts all the resources ApiStack needs.

Replace the entire contents of `lib/stacks/api-stack.ts` with the following:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';
```

```typescript
export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  // From DatabaseStack
  eventsTable: dynamodb.Table;
  registrationsTable: dynamodb.Table;
  ticketsTable: dynamodb.Table;
  // From StorageStack
  ticketsBucket: s3.Bucket;
  // From MessagingStack
  ticketGenerationQueue: sqs.Queue;
  // From AuthStack
  userPool: cognito.UserPool;
  // From FoundationStack
  webAcl: wafv2.CfnWebACL;
}
```

#### Step 24.3: Understand the Lambda Configuration Pattern

**What**: Every Lambda function is created with the same pattern using `NodejsFunction`. Here's what each property means:

```typescript
new NodejsFunction(this, 'CreateEventFn', {
  // Where is the code?
  entry: path.join(__dirname, '../../lambda/createEvent/index.ts'),
  handler: 'handler',           // Which exported function to call

  // Runtime
  runtime: lambda.Runtime.NODEJS_20_X,

  // Memory and timeout
  memorySize: 256,              // MB of RAM
  timeout: cdk.Duration.seconds(30),

  // Environment variables — injected into the Lambda at runtime
  environment: {
    EVENTS_TABLE: props.eventsTable.tableName,
    POWERTOOLS_SERVICE_NAME: 'createEvent',
    LOG_LEVEL: 'INFO',
  },

  // Bundling — esbuild settings
  bundling: {
    minify: true,               // Smaller bundle = faster cold start
    sourceMap: true,            // For debugging
    externalModules: [          // Don't bundle these — they're in the Lambda runtime
      '@aws-sdk/*',
    ],
  },
});
```

**Why `path.join(__dirname, '../../lambda/...')`?**
`__dirname` is the directory of the current file (`lib/stacks/`). We go up two levels (`../../`) to reach the project root, then into `lambda/`. This gives CDK the absolute path to your Lambda code.

**Why `externalModules: ['@aws-sdk/*']`?**
The AWS SDK v3 is already included in the Lambda runtime. Excluding it from the bundle makes the bundle smaller and faster to deploy.

#### Step 24.4: Write the Full ApiStack Class

Continue adding to `lib/stacks/api-stack.ts` after the imports and interface:

```typescript
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ==========================================
    // Shared Lambda configuration
    // ==========================================
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    };

    // Shared environment variables for all Lambdas
    const commonEnv = {
      EVENTS_TABLE: props.eventsTable.tableName,
      REGISTRATIONS_TABLE: props.registrationsTable.tableName,
      TICKETS_TABLE: props.ticketsTable.tableName,
      TICKETS_BUCKET: props.ticketsBucket.bucketName,
      TICKET_QUEUE_URL: props.ticketGenerationQueue.queueUrl,
      LOG_LEVEL: 'INFO',
      POWERTOOLS_METRICS_NAMESPACE: 'EventTicketing',
    };
```

    // ==========================================
    // Lambda Functions
    // ==========================================

    // --- Event Management ---
    const createEventFn = new NodejsFunction(this, 'CreateEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/createEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'createEvent' },
    });

    const listEventsFn = new NodejsFunction(this, 'ListEventsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/listEvents/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'listEvents' },
    });

    const getEventFn = new NodejsFunction(this, 'GetEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getEvent' },
    });

    const updateEventFn = new NodejsFunction(this, 'UpdateEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/updateEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'updateEvent' },
    });

    const deleteEventFn = new NodejsFunction(this, 'DeleteEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/deleteEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'deleteEvent' },
    });

    // --- Registration ---
    const createRegistrationFn = new NodejsFunction(this, 'CreateRegistrationFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/createRegistration/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'createRegistration' },
    });

    const getMyRegistrationsFn = new NodejsFunction(this, 'GetMyRegistrationsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getMyRegistrations/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getMyRegistrations' },
    });

    const getEventRegistrationsFn = new NodejsFunction(this, 'GetEventRegistrationsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getEventRegistrations/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getEventRegistrations' },
    });

    // --- Tickets ---
    const generateTicketFn = new NodejsFunction(this, 'GenerateTicketFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/generateTicket/index.ts'),
      handler: 'handler',
      memorySize: 512,                        // PDF generation needs more memory
      timeout: cdk.Duration.seconds(60),      // PDF + S3 upload can take longer
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'generateTicket' },
    });

    const getTicketDownloadFn = new NodejsFunction(this, 'GetTicketDownloadFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getTicketDownload/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getTicketDownload' },
    });

    const validateTicketFn = new NodejsFunction(this, 'ValidateTicketFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/validateTicket/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'validateTicket' },
    });

    // ==========================================
    // IAM Permissions (Least Privilege)
    // Each Lambda only gets access to what it needs
    // ==========================================

    // createEvent: write to events table
    props.eventsTable.grantWriteData(createEventFn);

    // listEvents: read from events table
    props.eventsTable.grantReadData(listEventsFn);

    // getEvent: read from events table
    props.eventsTable.grantReadData(getEventFn);

    // updateEvent: read+write events table
    props.eventsTable.grantReadWriteData(updateEventFn);

    // deleteEvent: read+write events table, read registrations table
    props.eventsTable.grantReadWriteData(deleteEventFn);
    props.registrationsTable.grantReadData(deleteEventFn);

    // createRegistration: read events, write registrations, send to SQS
    props.eventsTable.grantReadWriteData(createRegistrationFn);
    props.registrationsTable.grantReadWriteData(createRegistrationFn);
    props.ticketGenerationQueue.grantSendMessages(createRegistrationFn);

    // getMyRegistrations: read registrations table
    props.registrationsTable.grantReadData(getMyRegistrationsFn);

    // getEventRegistrations: read events + registrations tables
    props.eventsTable.grantReadData(getEventRegistrationsFn);
    props.registrationsTable.grantReadData(getEventRegistrationsFn);

    // generateTicket: read events+registrations, write tickets, write S3
    props.eventsTable.grantReadData(generateTicketFn);
    props.registrationsTable.grantReadWriteData(generateTicketFn);
    props.ticketsTable.grantReadWriteData(generateTicketFn);
    props.ticketsBucket.grantWrite(generateTicketFn);

    // getTicketDownload: read tickets table, read S3 (for presigned URL)
    props.ticketsTable.grantReadData(getTicketDownloadFn);
    props.ticketsBucket.grantRead(getTicketDownloadFn);

    // validateTicket: read+write tickets table
    props.ticketsTable.grantReadWriteData(validateTicketFn);

    // ==========================================
    // SQS Event Source for generateTicket
    // This wires SQS → Lambda (not an HTTP route)
    // ==========================================
    generateTicketFn.addEventSource(
      new lambdaEventSources.SqsEventSource(props.ticketGenerationQueue, {
        batchSize: 1,           // Process one ticket at a time
        reportBatchItemFailures: true,
      })
    );

    // ==========================================
    // HTTP API Gateway
    // ==========================================
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.projectName}-api-${props.environment}`,
      description: 'Event Ticketing V2 API',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],    // TODO: Week 5 — restrict to CloudFront domain
        maxAge: cdk.Duration.days(1),
      },
    });

    // ==========================================
    // Cognito JWT Authorizer
    // API Gateway validates the JWT token automatically
    // before your Lambda even runs
    // ==========================================
    const authorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [],        // Accept any client (we only have one)
        identitySource: ['$request.header.Authorization'],
      }
    );

    // ==========================================
    // Routes
    // ==========================================

    // Helper to create a Lambda integration
    const integration = (fn: lambda.IFunction) =>
      new apigatewayv2Integrations.HttpLambdaIntegration(`${fn.node.id}Integration`, fn);

    // --- Public routes (no auth required) ---
    this.httpApi.addRoutes({
      path: '/v1/events',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(listEventsFn),
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getEventFn),
    });

    // --- Protected routes (JWT required) ---
    this.httpApi.addRoutes({
      path: '/v1/events',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(createEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.PUT],
      integration: integration(updateEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: integration(deleteEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/registrations',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(createRegistrationFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/registrations/my',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getMyRegistrationsFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/registrations',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getEventRegistrationsFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/tickets/{ticketId}/download',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getTicketDownloadFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/tickets/validate',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(validateTicketFn),
      authorizer,
    });

    // ==========================================
    // Associate WAF WebACL with API Gateway
    // ==========================================
    new wafv2.CfnWebACLAssociation(this, 'ApiWafAssociation', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${this.httpApi.apiId}/stages/$default`,
      webAclArn: props.webAcl.attrArn,
    });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API Gateway URL — use this as your base URL',
      exportName: `${props.projectName}-${props.environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      exportName: `${props.projectName}-${props.environment}-api-id`,
    });
  }
}
```

**Expected Result**: `lib/stacks/api-stack.ts` is fully implemented with all 10 Lambda functions, routes, authorizer, and WAF association.

---

### Step 25: Update bin/event-ticketing-v2.ts

#### Step 25.1: Understand What Needs to Change

**What**: The `bin/` file is the CDK app entry point. It creates all stacks and wires them together. Right now, `ApiStack` is created with only `commonProps` — it doesn't receive the tables, buckets, queue, or user pool it needs.

**Why**: CDK stacks communicate by passing resource references as constructor props. The `bin/` file is where you connect the outputs of one stack to the inputs of another.

**How**: Replace the `ApiStack` instantiation block with one that passes all the required props.

#### Step 25.2: Replace the ApiStack Block

Find this section in `bin/event-ticketing-v2.ts`:

```typescript
// ==========================================
// Stack 6: API (HTTP API Gateway)
// Depends on: Auth (Cognito authorizer), Database, Messaging
// ==========================================
const apiStack = new ApiStack(
  app,
  `${projectName}-api-${environment}`,
  commonProps
);
apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
apiStack.addDependency(messagingStack);
apiStack.addDependency(storageStack);
```

Replace it with:

```typescript
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
    // From FoundationStack
    webAcl: foundationStack.webAcl,
  }
);
apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
apiStack.addDependency(messagingStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(foundationStack);
```

**Expected Result**: `bin/event-ticketing-v2.ts` now passes all required resources to ApiStack.

---

### Step 26: Install CDK Integration Packages

**What**: The ApiStack uses two CDK packages that may not be installed yet.

**Why**: `aws-apigatewayv2-integrations` and `aws-apigatewayv2-authorizers` are separate packages from the base `aws-apigatewayv2`.

**How**:
```bash
npm install @aws-cdk/aws-apigatewayv2-integrations-alpha
npm install @aws-cdk/aws-apigatewayv2-authorizers-alpha
```

Wait — actually these are now part of `aws-cdk-lib` in CDK v2. Check your current imports work by running:

```bash
npx tsc --noEmit
```

If you see errors like `Cannot find module 'aws-cdk-lib/aws-apigatewayv2-integrations'`, run:

```bash
npm install @aws-cdk/aws-apigatewayv2-integrations-alpha @aws-cdk/aws-apigatewayv2-authorizers-alpha
```

And update the imports in `api-stack.ts` to:
```typescript
import * as apigatewayv2Integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as apigatewayv2Authorizers from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
```

**Expected Result**: TypeScript compiles without errors.

---

### Step 27: Deploy the ApiStack

**What**: Deploy all Lambda functions and the API Gateway to AWS.

**Why**: This is the big moment — after this step, you'll have a live REST API.

**How**:

First, do a dry run to see what CDK will create:
```bash
npx cdk diff event-ticketing-v2-api-dev
```

You should see it will create:
- 10 Lambda functions
- 1 HTTP API Gateway
- 10 API routes
- 1 JWT Authorizer
- 1 WAF WebACL Association
- IAM roles and policies for each Lambda

Then deploy:
```bash
npx cdk deploy event-ticketing-v2-api-dev
```

**Expected Result**: Stack deploys successfully. At the end you'll see output like:
```
Outputs:
event-ticketing-v2-api-dev.ApiUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com
event-ticketing-v2-api-dev.ApiId = abc123xyz
```

**Save the API URL** — you'll need it for testing in the next section.

---

## Part 6: Testing the API (Day 15)

### Step 28: Get a Cognito JWT Token

**What**: Before you can call protected endpoints, you need a JWT token from Cognito.

**Why**: The JWT authorizer in API Gateway validates this token on every protected request. Without it, you get a 401 Unauthorized.

**How**:

#### Step 28.1: Create a Test User

First, sign up a test user via the Cognito CLI:

```bash
# Replace YOUR_CLIENT_ID with the value from the auth stack output
# Get it with:
aws cognito-idp describe-user-pool-client \
  --user-pool-id $(aws cognito-idp list-user-pools --max-results 10 \
    --query "UserPools[?Name=='event-ticketing-v2-users-dev'].Id" --output text) \
  --client-id $(aws cognito-idp list-user-pool-clients \
    --user-pool-id $(aws cognito-idp list-user-pools --max-results 10 \
      --query "UserPools[?Name=='event-ticketing-v2-users-dev'].Id" --output text) \
    --query "UserPoolClients[0].ClientId" --output text) \
  --query "UserPoolClient.ClientId" --output text
```

Or just get it from SSM (easier):
```bash
# Get User Pool ID
USER_POOL_ID=$(aws ssm get-parameter \
  --name "/event-ticketing/dev/cognito/user-pool-id" \
  --query "Parameter.Value" --output text)

# Get Client ID
CLIENT_ID=$(aws ssm get-parameter \
  --name "/event-ticketing/dev/cognito/client-id" \
  --query "Parameter.Value" --output text)

echo "User Pool ID: $USER_POOL_ID"
echo "Client ID: $CLIENT_ID"
```

#### Step 28.2: Sign Up and Confirm a Test User

```bash
# Sign up
aws cognito-idp sign-up \
  --client-id $CLIENT_ID \
  --username "testorganizer@example.com" \
  --password "Test1234!" \
  --user-attributes Name=email,Value="testorganizer@example.com"

# Admin confirm (skip email verification for testing)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id $USER_POOL_ID \
  --username "testorganizer@example.com"

# Add to Organizers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username "testorganizer@example.com" \
  --group-name "Organizers"
```

#### Step 28.3: Get a JWT Token

```bash
# Authenticate and get tokens
AUTH_RESULT=$(aws cognito-idp initiate-auth \
  --auth-flow USER_SRP_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters USERNAME="testorganizer@example.com",SRP_A=$(python3 -c "import secrets; print(secrets.token_hex(32))")
)
```

**Note**: SRP auth is complex from the CLI. The easiest way to get a token for testing is to use the `USER_PASSWORD_AUTH` flow. But our client has `userPassword: false`. 

**Simplest approach** — temporarily enable admin auth:

```bash
# Get token using admin auth (bypasses SRP)
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id $USER_POOL_ID \
  --client-id $CLIENT_ID \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="testorganizer@example.com",PASSWORD="Test1234!" \
  --query "AuthenticationResult.IdToken" --output text)

echo "Token: $TOKEN"
```

**If you get an error** about `ADMIN_USER_PASSWORD_AUTH` not being enabled, update the UserPoolClient in `auth-stack.ts` to add `adminUserPassword: true` temporarily, redeploy auth stack, then run the command above.

**Save the token**:
```bash
export API_TOKEN=$TOKEN
export API_URL="https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com"
# Replace YOUR_API_ID with the value from the deploy output
```

---

### Step 29: Test All Endpoints

**What**: Verify every endpoint works correctly.

**Why**: Catch any wiring issues (wrong env vars, missing permissions, typos in route paths) before moving to Phase 4.

#### Step 29.1: Test Public Endpoints (No Auth)

```bash
# List events (should return empty list initially)
curl -s "$API_URL/v1/events" | jq .

# Expected response:
# {
#   "events": [],
#   "count": 0
# }
```

#### Step 29.2: Test Create Event (Requires Auth)

```bash
# Create an event
curl -s -X POST "$API_URL/v1/events" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AWS re:Invent 2026",
    "description": "The biggest AWS conference of the year",
    "date": "2026-12-01T09:00:00.000Z",
    "location": "Las Vegas Convention Center",
    "capacity": 50000,
    "price": 1999,
    "category": "conference"
  }' | jq .

# Expected response (201):
# {
#   "eventId": "uuid-here",
#   "name": "AWS re:Invent 2026",
#   "status": "active",
#   ...
# }

# Save the eventId for subsequent tests
export EVENT_ID="paste-the-eventId-here"
```

#### Step 29.3: Test Get Event

```bash
# Get the event we just created (no auth needed)
curl -s "$API_URL/v1/events/$EVENT_ID" | jq .

# Expected: full event object with 200 status
```

#### Step 29.4: Test List Events (Should Now Show 1 Event)

```bash
curl -s "$API_URL/v1/events" | jq .

# Expected:
# {
#   "events": [{ "eventId": "...", "name": "AWS re:Invent 2026", ... }],
#   "count": 1
# }
```

#### Step 29.5: Test Update Event

```bash
curl -s -X PUT "$API_URL/v1/events/$EVENT_ID" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description for the conference"}' | jq .

# Expected: { "message": "Event updated successfully", "eventId": "..." }
```

#### Step 29.6: Test Create Registration

First create an attendee user:
```bash
# Sign up attendee
aws cognito-idp sign-up \
  --client-id $CLIENT_ID \
  --username "testattendee@example.com" \
  --password "Test1234!" \
  --user-attributes Name=email,Value="testattendee@example.com"

aws cognito-idp admin-confirm-sign-up \
  --user-pool-id $USER_POOL_ID \
  --username "testattendee@example.com"

# Get attendee token
ATTENDEE_TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id $USER_POOL_ID \
  --client-id $CLIENT_ID \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="testattendee@example.com",PASSWORD="Test1234!" \
  --query "AuthenticationResult.IdToken" --output text)
```

Then register:
```bash
# Generate a unique idempotency key
IDEMPOTENCY_KEY=$(uuidgen)

curl -s -X POST "$API_URL/v1/registrations" \
  -H "Authorization: Bearer $ATTENDEE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{\"eventId\": \"$EVENT_ID\"}" | jq .

# Expected (201):
# {
#   "registrationId": "uuid",
#   "eventId": "...",
#   "message": "Registration successful. Your ticket will be emailed shortly.",
#   ...
# }

export REGISTRATION_ID="paste-registrationId-here"
```

#### Step 29.7: Test Get My Registrations

```bash
curl -s "$API_URL/v1/registrations/my" \
  -H "Authorization: Bearer $ATTENDEE_TOKEN" | jq .

# Expected: list with the registration we just created
```

#### Step 29.8: Test Get Event Registrations (Organizer Only)

```bash
curl -s "$API_URL/v1/events/$EVENT_ID/registrations" \
  -H "Authorization: Bearer $API_TOKEN" | jq .

# Expected: list with the attendee's registration
```

#### Step 29.9: Test Ticket Download

Wait ~5 seconds for the async ticket generation to complete, then:

```bash
# The ticketId is the same as the registrationId
curl -s "$API_URL/v1/tickets/$REGISTRATION_ID/download" \
  -H "Authorization: Bearer $ATTENDEE_TOKEN" | jq .

# Expected:
# {
#   "downloadUrl": "https://s3.amazonaws.com/...?X-Amz-Signature=...",
#   "expiresIn": 900,
#   "ticket": { "ticketId": "...", "eventName": "...", "status": "generated" }
# }

# Download the actual PDF
curl -L "$(curl -s "$API_URL/v1/tickets/$REGISTRATION_ID/download" \
  -H "Authorization: Bearer $ATTENDEE_TOKEN" | jq -r '.downloadUrl')" \
  -o my-ticket.pdf

open my-ticket.pdf  # Opens in Preview on macOS
```

#### Step 29.10: Test Validate Ticket

```bash
# Get the QR code data from the ticket record
# The QR payload is: {"ticketId":"<registrationId>","eventId":"<eventId>","userId":"<userId>","timestamp":"..."}
QR_PAYLOAD=$(echo "{\"ticketId\":\"$REGISTRATION_ID\",\"eventId\":\"$EVENT_ID\",\"userId\":\"test\"}")

curl -s -X POST "$API_URL/v1/tickets/validate" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"qrCodeData\": \"$QR_PAYLOAD\", \"eventId\": \"$EVENT_ID\"}" | jq .

# Expected:
# {
#   "valid": true,
#   "ticketId": "...",
#   "attendeeName": "...",
#   "validatedAt": "..."
# }

# Try validating again — should get 409 CONFLICT
curl -s -X POST "$API_URL/v1/tickets/validate" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"qrCodeData\": \"$QR_PAYLOAD\", \"eventId\": \"$EVENT_ID\"}" | jq .

# Expected: { "error": { "code": "CONFLICT", "message": "Ticket has already been validated" } }
```

---

## Phase 3 Complete ✅

### What You Built

You now have a fully working serverless REST API on AWS:

- 10 Lambda functions handling all business logic
- HTTP API Gateway with Cognito JWT authentication
- WAF protection (rate limiting + managed rule sets)
- Async ticket generation via SQS
- PDF tickets with QR codes stored in S3
- DynamoDB for all data with proper GSI queries
- Idempotent registration (safe to retry)
- Ownership checks on all write operations

### Architecture Deployed

```
Internet → WAF → API Gateway → JWT Authorizer → Lambda → DynamoDB/S3/SQS
                                                    ↑
                                              SQS → generateTicket → S3 + DynamoDB
```

### Cost Estimate (Dev Usage)

| Service | Estimated Monthly Cost |
|---------|----------------------|
| Lambda (10 functions, low traffic) | ~$0.00 (free tier) |
| API Gateway (HTTP API) | ~$1.00 per million requests |
| DynamoDB (on-demand, low traffic) | ~$0.00 (free tier) |
| S3 (ticket PDFs) | ~$0.02 per GB |
| SQS (FIFO queue) | ~$0.00 (free tier) |
| WAF | ~$5.00/month base + $0.60/million requests |
| **Total** | **~$5-10/month at dev scale** |

### What's Next: Phase 4

Phase 4 covers:
- CloudFront distribution for the frontend
- S3 static website hosting
- React frontend (or basic HTML for testing)
- Email notifications via SES when tickets are generated
- Enhanced observability (CloudWatch dashboards, alarms)

---

## Troubleshooting

### Error: "Cannot find module 'aws-cdk-lib/aws-apigatewayv2-integrations'"

The HTTP API integrations and authorizers packages moved to alpha in CDK v2. Install them:

```bash
npm install @aws-cdk/aws-apigatewayv2-integrations-alpha @aws-cdk/aws-apigatewayv2-authorizers-alpha
```

Then update your imports in `api-stack.ts`:
```typescript
import * as apigatewayv2Integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as apigatewayv2Authorizers from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
```

---

### Error: "Cannot find module 'zod'"

```bash
npm install zod
```

---

### Error: "Cannot find module '@aws-lambda-powertools/logger'"

```bash
npm install @aws-lambda-powertools/logger @aws-lambda-powertools/tracer @aws-lambda-powertools/metrics
```

---

### Error: Lambda returns 500 on first invocation

Check CloudWatch Logs:
```bash
# List log groups for your Lambda
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/event-ticketing-v2" \
  --query "logGroups[*].logGroupName" --output table

# Get recent logs for a specific function
aws logs tail /aws/lambda/event-ticketing-v2-api-dev-CreateEventFn \
  --since 10m --format short
```

Common causes:
- Missing environment variable (check the Lambda's configuration in AWS Console)
- IAM permission denied (check the error message — it will say which action was denied)
- DynamoDB table name typo (verify with `aws dynamodb list-tables`)

---

### Error: "401 Unauthorized" on protected endpoints

Your JWT token may have expired (tokens last 1 hour). Get a new one:
```bash
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id $USER_POOL_ID \
  --client-id $CLIENT_ID \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="testorganizer@example.com",PASSWORD="Test1234!" \
  --query "AuthenticationResult.IdToken" --output text)
export API_TOKEN=$TOKEN
```

---

### Error: "403 Forbidden" when creating an event

Make sure you're using the organizer's token (not the attendee's). Also verify the user is in the Organizers group:
```bash
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id $USER_POOL_ID \
  --username "testorganizer@example.com"
```

---

### Error: Ticket not generated after registration

Check the SQS queue and DLQ:
```bash
# Check if messages are stuck in the queue
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url \
    --queue-name "event-ticketing-v2-ticket-generation-dev.fifo" \
    --query "QueueUrl" --output text) \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible

# Check DLQ for failed messages
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url \
    --queue-name "event-ticketing-v2-ticket-generation-dlq-dev.fifo" \
    --query "QueueUrl" --output text) \
  --attribute-names ApproximateNumberOfMessages
```

If messages are in the DLQ, check the `generateTicket` Lambda logs:
```bash
aws logs tail /aws/lambda/event-ticketing-v2-api-dev-GenerateTicketFn \
  --since 30m --format short
```

---

### Error: "WAF WebACL association failed"

The WAF association for HTTP API Gateway uses a specific ARN format. If the association fails, you can skip it for now and add it manually:

```bash
# Get your API ID from the deploy output, then:
aws wafv2 associate-web-acl \
  --web-acl-arn $(aws cloudformation describe-stacks \
    --stack-name event-ticketing-v2-foundation-dev \
    --query "Stacks[0].Outputs[?OutputKey=='WebAclArn'].OutputValue" \
    --output text) \
  --resource-arn "arn:aws:apigateway:us-east-1::/restapis/YOUR_API_ID/stages/$default"
```

The WAF is a security enhancement — the API works without it, so don't let this block you.

---

### TypeScript Compilation Errors

Run the TypeScript compiler to see all errors at once:
```bash
npx tsc --noEmit
```

Fix errors top-to-bottom — often one root cause creates many downstream errors.

---

*End of Phase 3 Implementation Guide*
