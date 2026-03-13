# Technical Design Document: Event Ticketing System V2

## Overview

The Event Ticketing System V2 is a production-grade serverless event management platform built on AWS, designed to replace the V1 prototype with enterprise-level architecture, security, and operational practices. The system enables event organizers to create and manage events while providing attendees with seamless event discovery, registration, payment processing, and digital ticket delivery.

### System Goals

- Provide a scalable, serverless architecture handling 100+ concurrent registrations per second
- Implement comprehensive observability with structured logging, distributed tracing, and custom business metrics
- Ensure security through defense-in-depth with WAF, JWT authentication, per-function IAM roles, and secrets management
- Enable reliable operations through automated CI/CD, monitoring, alerting, and disaster recovery
- Optimize costs through ARM64 Lambda functions, intelligent caching, and resource tagging
- Support future multi-region expansion while initially deploying to single region (us-east-1)

### Key Improvements from V1

The V2 system addresses critical V1 deficiencies:

- **Infrastructure as Code**: Migrates from raw CloudFormation YAML to type-safe AWS CDK TypeScript
- **Single Region**: Consolidates from 2 regions (us-east-1, eu-north-1) to single region eliminating cross-region latency
- **Least Privilege IAM**: Replaces single shared IAM role with per-function roles reducing permissions by 80%+
- **Async Processing**: Decouples ticket generation from HTTP response using SQS FIFO queues
- **Observability**: Replaces console.log with Lambda Powertools providing structured logging, X-Ray tracing, and CloudWatch metrics
- **Secrets Management**: Eliminates hardcoded credentials using AWS Secrets Manager and Parameter Store
- **Security Layers**: Adds WAF protection on CloudFront and API Gateway
- **Automated CI/CD**: Implements GitHub Actions with OIDC authentication replacing manual deployments
- **Caching Strategy**: Adds ElastiCache for event listings reducing DynamoDB read load
- **Email Delivery**: Integrates SES for reliable transactional email delivery


## Architecture

### High-Level Architecture

The system follows a serverless event-driven architecture with the following layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  React + Vite Frontend (CloudFront + S3)                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS (WAF Protected)
┌────────────────────────▼────────────────────────────────────────┐
│                     API Gateway Layer                            │
│  HTTP API v2 with JWT Authorizer + WAF                          │
└────────────┬───────────────────────────────┬────────────────────┘
             │                               │
┌────────────▼────────────┐     ┌───────────▼──────────────┐
│   Compute Layer         │     │   Async Processing       │
│   Lambda Functions      │────▶│   SQS FIFO Queue        │
│   (Lambda Powertools)   │     │   Ticket Generation      │
└────────┬────────────────┘     └───────────┬──────────────┘
         │                                   │
┌────────▼───────────────────────────────────▼──────────────┐
│                    Data Layer                              │
│  DynamoDB Tables + ElastiCache + S3 + Secrets Manager     │
└────────────────────────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────────────────┐
│                 Observability Layer                          │
│  CloudWatch Logs + X-Ray + Metrics + Alarms + Dashboards   │
└──────────────────────────────────────────────────────────────┘
```

### CDK Stack Structure

The infrastructure is organized into 7 modular CDK stacks for separation of concerns:

1. **FoundationStack**: VPC, networking, KMS keys, cost allocation tags
2. **AuthStack**: Cognito User Pool, User Pool Client, Identity Pool, JWT authorizer
3. **DatabaseStack**: DynamoDB tables (Events, Registrations, Tickets) with GSIs
4. **StorageStack**: S3 buckets for tickets and frontend, lifecycle policies
5. **ApiStack**: HTTP API Gateway, Lambda functions, IAM roles, API routes
6. **MessagingStack**: SQS FIFO queue, dead letter queue, ticket generation Lambda
7. **ObservabilityStack**: CloudWatch dashboards, alarms, X-Ray configuration, SNS topics

This modular structure enables:
- Independent stack updates without full redeployment
- Clear dependency management between infrastructure layers
- Reusable constructs across multiple environments
- Simplified testing and validation of individual components

### Regional Architecture

**Phase 1 (Current)**: Single region deployment in us-east-1
- All compute, storage, and data resources in us-east-1
- CloudFront provides global edge caching for frontend and API responses
- Supports up to 10,000 concurrent users with sub-500ms latency in North America

**Phase 2 (Future)**: Multi-region expansion
- DynamoDB Global Tables for active-active replication
- Route 53 latency-based routing to regional API endpoints
- Regional S3 buckets with cross-region replication for tickets
- Regional SQS queues for ticket generation
- Shared Cognito User Pool with regional read replicas


## Components and Interfaces

### API Gateway HTTP API

**Technology**: AWS API Gateway HTTP API (v2)

**Endpoints**:

```
GET    /v1/events                    # Public - List events (cached)
GET    /v1/events/{eventId}          # Public - Get event details
POST   /v1/events                    # Protected - Create event (Organizer)
PUT    /v1/events/{eventId}          # Protected - Update event (Organizer)
DELETE /v1/events/{eventId}          # Protected - Delete event (Organizer)
GET    /v1/events/my                 # Protected - List my events (Organizer)

POST   /v1/registrations             # Protected - Register for event (Attendee)
GET    /v1/registrations/my          # Protected - List my registrations (Attendee)
GET    /v1/registrations/{regId}     # Protected - Get registration details

GET    /v1/tickets/{ticketId}        # Protected - Download ticket PDF
POST   /v1/tickets/validate          # Protected - Validate QR code (Organizer)

GET    /docs                         # Public - OpenAPI specification
```

**Authentication**:
- JWT authorizer validates Cognito tokens on all endpoints except public event listing
- Token claims include: `sub` (user ID), `email`, `cognito:groups` (Organizer/Attendee)
- Authorization logic checks group membership for role-specific operations

**Rate Limiting**:
- WAF rule: 100 requests per 5 minutes per IP address
- API Gateway throttling: 1000 requests per second burst, 500 steady state

**CORS Configuration**:
- Allowed origins: CloudFront distribution domain
- Allowed methods: GET, POST, PUT, DELETE, OPTIONS
- Allowed headers: Authorization, Content-Type, X-Idempotency-Key
- Max age: 3600 seconds

### Lambda Functions

All Lambda functions use:
- Runtime: Node.js 20.x on ARM64 architecture
- Lambda Powertools for TypeScript (Logger, Tracer, Metrics)
- Environment variables from Parameter Store
- Secrets from Secrets Manager
- X-Ray active tracing enabled

#### 1. CreateEventFunction

**Purpose**: Create new event records

**IAM Permissions**:
- `dynamodb:PutItem` on Events table
- `secretsmanager:GetSecretValue` for database credentials
- `xray:PutTraceSegments`

**Input**: Event metadata (title, description, date, location, capacity, price)

**Output**: Created event object with eventId

**Error Handling**: Returns 400 for validation errors, 500 for DynamoDB failures

#### 2. ListEventsFunction

**Purpose**: List available events with caching

**IAM Permissions**:
- `dynamodb:Query` on Events table with DateIndex GSI
- `elasticache:*` for cache access
- `xray:PutTraceSegments`

**Caching Strategy**:
- Check ElastiCache first (cache-aside pattern)
- Cache key: `events:list:{filters}:{page}`
- TTL: 60 seconds
- On cache miss: Query DynamoDB, populate cache, return results

**Input**: Query parameters (date range, location, page, limit)

**Output**: Paginated event list with nextToken

#### 3. GetEventFunction

**Purpose**: Retrieve single event details

**IAM Permissions**:
- `dynamodb:GetItem` on Events table
- `elasticache:*` for cache access

**Caching Strategy**:
- Cache key: `event:{eventId}`
- TTL: 300 seconds
- Invalidate on event updates

#### 4. UpdateEventFunction

**Purpose**: Update event metadata

**IAM Permissions**:
- `dynamodb:UpdateItem` on Events table with condition expression
- `elasticache:*` for cache invalidation

**Authorization**: Verify `organizerId` matches token `sub` claim

**Validation**: Prevent updates if active registrations exist and capacity is reduced

#### 5. DeleteEventFunction

**Purpose**: Delete events without registrations

**IAM Permissions**:
- `dynamodb:DeleteItem` on Events table with condition expression
- `dynamodb:Query` on Registrations table with EventIndex GSI

**Validation**: Check for active registrations before deletion

#### 6. CreateRegistrationFunction

**Purpose**: Process event registration with payment

**IAM Permissions**:
- `dynamodb:PutItem` on Registrations table with conditional write
- `dynamodb:UpdateItem` on Events table for capacity decrement
- `sqs:SendMessage` to ticket generation queue
- `secretsmanager:GetSecretValue` for Stripe API key

**Idempotency**: Uses Lambda Powertools idempotency decorator with DynamoDB persistence

**Flow**:
1. Validate idempotency key (required header)
2. Check event capacity with strongly consistent read
3. Create Stripe Payment Intent
4. On payment success: Create registration record, decrement capacity atomically
5. Publish Registration_Event to SQS FIFO queue
6. Return 201 Created with registration details (ticket generation happens async)

**Error Handling**:
- 400: Invalid input or missing idempotency key
- 409: Event sold out (capacity reached)
- 402: Payment failed
- 500: DynamoDB or SQS failures

#### 7. GetMyRegistrationsFunction

**Purpose**: List user's registrations

**IAM Permissions**:
- `dynamodb:Query` on Registrations table with UserIndex GSI

**Authorization**: Filter by token `sub` claim

#### 8. GenerateTicketFunction

**Purpose**: Async ticket generation from SQS events

**Trigger**: SQS FIFO queue messages

**IAM Permissions**:
- `dynamodb:GetItem` on Registrations and Events tables
- `dynamodb:PutItem` on Tickets table
- `s3:PutObject` on tickets bucket
- `ses:SendTemplatedEmail`
- `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`

**Idempotency**: Check Tickets table for existing ticketId before generation

**Flow**:
1. Parse Registration_Event from SQS message
2. Fetch registration and event details from DynamoDB
3. Generate unique QR code (JSON: `{ticketId, eventId, userId, timestamp}`)
4. Create PDF with PDFKit (event details, attendee name, QR code)
5. Upload PDF to S3 with 7-day expiration
6. Create ticket record in DynamoDB
7. Generate presigned S3 URL (7-day expiration)
8. Send email via SES with ticket attachment link
9. Delete SQS message on success

**Error Handling**:
- Retry 3 times with exponential backoff
- On final failure: Send to dead letter queue
- Log all failures with correlation ID

#### 9. GetTicketDownloadFunction

**Purpose**: Generate presigned URL for ticket download

**IAM Permissions**:
- `dynamodb:GetItem` on Tickets table
- `s3:GetObject` on tickets bucket

**Authorization**: Verify ticket belongs to requesting user

**Output**: Presigned S3 URL valid for 15 minutes

#### 10. ValidateTicketFunction

**Purpose**: Validate QR codes at event entry

**IAM Permissions**:
- `dynamodb:GetItem` on Tickets table
- `dynamodb:UpdateItem` on Tickets table for status update

**Flow**:
1. Decode QR code to extract ticketId
2. Fetch ticket from DynamoDB
3. Verify ticket matches eventId from request
4. Check ticket status (not already validated)
5. Update ticket status to "validated" with timestamp
6. Return validation result

**Error Handling**:
- 404: Ticket not found or invalid QR code
- 409: Ticket already validated
- 403: Ticket doesn't match event


### SQS FIFO Queue

**Queue Name**: `ticket-generation-queue.fifo`

**Configuration**:
- Message retention: 4 days
- Visibility timeout: 30 seconds (2x Lambda timeout)
- Receive wait time: 20 seconds (long polling)
- Content-based deduplication: Enabled
- Dead letter queue: `ticket-generation-dlq.fifo` (max receive count: 3)

**Message Format**:
```json
{
  "registrationId": "uuid",
  "eventId": "uuid",
  "userId": "cognito-sub",
  "userName": "string",
  "userEmail": "string",
  "eventName": "string",
  "eventDate": "ISO8601",
  "eventLocation": "string",
  "amount": "number",
  "timestamp": "ISO8601"
}
```

**Message Group ID**: `{eventId}` (ensures ordered processing per event)

**Deduplication ID**: `{registrationId}` (prevents duplicate ticket generation)

### DynamoDB Tables

#### Events Table

**Table Name**: `Events`

**Primary Key**:
- Partition Key: `eventId` (String, UUID)

**Attributes**:
- `organizerId` (String) - Cognito user sub
- `name` (String)
- `description` (String)
- `date` (String, ISO8601)
- `location` (String)
- `capacity` (Number)
- `availableCapacity` (Number) - Decremented atomically
- `price` (Number)
- `category` (String)
- `status` (String) - "active" | "sold_out" | "cancelled"
- `createdAt` (String, ISO8601)
- `updatedAt` (String, ISO8601)

**Global Secondary Indexes**:

1. **OrganizerIndex**
   - Partition Key: `organizerId`
   - Sort Key: `createdAt`
   - Projection: ALL
   - Use case: List events by organizer

2. **DateIndex**
   - Partition Key: `status`
   - Sort Key: `date`
   - Projection: ALL
   - Use case: List active events by date

3. **CategoryIndex**
   - Partition Key: `category`
   - Sort Key: `date`
   - Projection: ALL
   - Use case: Filter events by category

**Billing Mode**: On-demand

**Point-in-Time Recovery**: Enabled (35-day retention)

**Encryption**: AWS managed KMS key

#### Registrations Table

**Table Name**: `Registrations`

**Primary Key**:
- Partition Key: `registrationId` (String, UUID)

**Attributes**:
- `eventId` (String)
- `userId` (String) - Cognito user sub
- `userName` (String)
- `userEmail` (String)
- `registeredAt` (String, ISO8601)
- `paymentStatus` (String) - "pending" | "confirmed" | "failed" | "refunded"
- `paymentIntentId` (String) - Stripe Payment Intent ID
- `amount` (Number)
- `ticketId` (String) - Populated after ticket generation
- `idempotencyKey` (String) - Client-provided UUID

**Global Secondary Indexes**:

1. **UserIndex**
   - Partition Key: `userId`
   - Sort Key: `registeredAt`
   - Projection: ALL
   - Use case: List registrations by user

2. **EventIndex**
   - Partition Key: `eventId`
   - Sort Key: `registeredAt`
   - Projection: ALL
   - Use case: List registrations by event

3. **IdempotencyIndex**
   - Partition Key: `idempotencyKey`
   - Sort Key: `registeredAt`
   - Projection: ALL
   - TTL: 24 hours
   - Use case: Idempotency checks

**Billing Mode**: On-demand

**Point-in-Time Recovery**: Enabled

#### Tickets Table

**Table Name**: `Tickets`

**Primary Key**:
- Partition Key: `ticketId` (String, UUID)

**Attributes**:
- `registrationId` (String)
- `eventId` (String)
- `userId` (String)
- `qrCode` (String) - Base64 encoded QR code data
- `status` (String) - "generated" | "validated" | "expired"
- `generatedAt` (String, ISO8601)
- `validatedAt` (String, ISO8601, optional)
- `s3Key` (String) - S3 object key for PDF
- `eventName` (String)
- `eventDate` (String, ISO8601)
- `eventLocation` (String)
- `attendeeName` (String)

**Global Secondary Indexes**:

1. **UserIndex**
   - Partition Key: `userId`
   - Sort Key: `generatedAt`
   - Projection: ALL
   - Use case: List tickets by user

2. **EventIndex**
   - Partition Key: `eventId`
   - Sort Key: `generatedAt`
   - Projection: ALL
   - Use case: List tickets by event

3. **QRCodeIndex**
   - Partition Key: `qrCode`
   - Projection: ALL
   - Use case: Fast QR code validation lookups

**Billing Mode**: On-demand

**Point-in-Time Recovery**: Enabled

### ElastiCache Serverless

**Cluster Name**: `event-ticketing-cache`

**Engine**: Redis 7.x

**Mode**: Serverless (auto-scaling)

**Configuration**:
- Max ECPUs: 5000
- Snapshot retention: 1 day
- Encryption in transit: Enabled (TLS)
- Encryption at rest: Enabled

**Cache Keys**:
- `events:list:{filters}:{page}` - Event listings (TTL: 60s)
- `event:{eventId}` - Event details (TTL: 300s)

**Eviction Policy**: allkeys-lru (least recently used)

### S3 Buckets

#### Tickets Bucket

**Bucket Name**: `{account-id}-event-tickets-{stage}`

**Configuration**:
- Versioning: Enabled
- Encryption: AES-256 (SSE-S3)
- Block public access: Enabled
- Lifecycle policy: Delete objects after 7 days
- CORS: Enabled for presigned URL access

**Object Key Format**: `tickets/{year}/{month}/{ticketId}.pdf`

#### Frontend Bucket

**Bucket Name**: `{account-id}-event-ticketing-frontend-{stage}`

**Configuration**:
- Versioning: Enabled
- Encryption: AES-256
- Block public access: Enabled (CloudFront OAI only)
- Static website hosting: Disabled (CloudFront serves)

### Secrets Manager

**Secrets**:

1. **stripe-api-key**
   - Description: Stripe secret API key
   - Rotation: Manual (on key compromise)
   - Access: CreateRegistrationFunction only

2. **database-credentials**
   - Description: DynamoDB access credentials (future RDS migration)
   - Rotation: Automatic (30 days)
   - Access: All Lambda functions

3. **cognito-client-secret**
   - Description: Cognito User Pool Client secret
   - Rotation: Manual
   - Access: AuthStack only

**Encryption**: Customer managed KMS key

### Parameter Store

**Parameters** (non-sensitive configuration):

- `/event-ticketing/{stage}/api-endpoint` - API Gateway URL
- `/event-ticketing/{stage}/cognito-user-pool-id` - Cognito User Pool ID
- `/event-ticketing/{stage}/cognito-client-id` - Cognito Client ID
- `/event-ticketing/{stage}/region` - AWS region
- `/event-ticketing/{stage}/tickets-bucket` - S3 bucket name
- `/event-ticketing/{stage}/cache-endpoint` - ElastiCache endpoint
- `/event-ticketing/{stage}/queue-url` - SQS queue URL

**Tier**: Standard (free tier)

**Encryption**: AWS managed KMS key


## Data Models

### Event Model

```typescript
interface Event {
  eventId: string;           // UUID
  organizerId: string;       // Cognito user sub
  name: string;              // Max 200 chars
  description: string;       // Max 2000 chars
  date: string;              // ISO8601 format
  location: string;          // Max 500 chars
  capacity: number;          // Positive integer
  availableCapacity: number; // 0 <= availableCapacity <= capacity
  price: number;             // USD cents (e.g., 2500 = $25.00)
  category: string;          // "conference" | "concert" | "workshop" | "sports" | "other"
  status: string;            // "active" | "sold_out" | "cancelled"
  createdAt: string;         // ISO8601 timestamp
  updatedAt: string;         // ISO8601 timestamp
}
```

**Validation Rules**:
- `name`: Required, 1-200 characters
- `description`: Required, 1-2000 characters
- `date`: Required, must be future date
- `location`: Required, 1-500 characters
- `capacity`: Required, positive integer, max 100,000
- `price`: Required, non-negative integer (0 for free events)
- `category`: Required, one of enum values
- `availableCapacity`: Computed, never exceeds capacity

**Invariants**:
- `availableCapacity <= capacity` at all times
- `status = "sold_out"` when `availableCapacity = 0`
- Events with `status = "cancelled"` cannot accept new registrations

### Registration Model

```typescript
interface Registration {
  registrationId: string;    // UUID
  eventId: string;           // Foreign key to Event
  userId: string;            // Cognito user sub
  userName: string;          // From Cognito token
  userEmail: string;         // From Cognito token
  registeredAt: string;      // ISO8601 timestamp
  paymentStatus: string;     // "pending" | "confirmed" | "failed" | "refunded"
  paymentIntentId: string;   // Stripe Payment Intent ID
  amount: number;            // USD cents
  ticketId?: string;         // Populated after async ticket generation
  idempotencyKey: string;    // Client-provided UUID
}
```

**Validation Rules**:
- `eventId`: Must reference existing active event
- `userId`: Must match authenticated user
- `amount`: Must match event price at registration time
- `idempotencyKey`: Required, UUID format, unique within 24 hours

**State Transitions**:
- `pending` → `confirmed` (payment succeeds)
- `pending` → `failed` (payment fails)
- `confirmed` → `refunded` (manual refund)

### Ticket Model

```typescript
interface Ticket {
  ticketId: string;          // UUID
  registrationId: string;    // Foreign key to Registration
  eventId: string;           // Foreign key to Event
  userId: string;            // Cognito user sub
  qrCode: string;            // Base64 encoded QR code image
  status: string;            // "generated" | "validated" | "expired"
  generatedAt: string;       // ISO8601 timestamp
  validatedAt?: string;      // ISO8601 timestamp (when scanned)
  s3Key: string;             // S3 object key for PDF
  eventName: string;         // Denormalized for PDF generation
  eventDate: string;         // Denormalized for PDF generation
  eventLocation: string;     // Denormalized for PDF generation
  attendeeName: string;      // Denormalized for PDF generation
}
```

**QR Code Payload**:
```json
{
  "ticketId": "uuid",
  "eventId": "uuid",
  "userId": "cognito-sub",
  "timestamp": "ISO8601"
}
```

**Validation Rules**:
- `ticketId`: Unique, UUID format
- `qrCode`: Base64 encoded PNG image
- `s3Key`: Must reference existing S3 object
- `status`: Cannot transition from "validated" back to "generated"

**State Transitions**:
- `generated` → `validated` (QR code scanned at event)
- `generated` → `expired` (event date + 7 days passed)

### API Request/Response Models

#### Create Event Request

```typescript
interface CreateEventRequest {
  name: string;
  description: string;
  date: string;              // ISO8601
  location: string;
  capacity: number;
  price: number;             // USD cents
  category: string;
}
```

#### Create Registration Request

```typescript
interface CreateRegistrationRequest {
  eventId: string;
  paymentMethodId: string;   // Stripe Payment Method ID
}

// Headers:
// X-Idempotency-Key: uuid
```

#### Validate Ticket Request

```typescript
interface ValidateTicketRequest {
  qrCodeData: string;        // Base64 encoded QR code payload
  eventId: string;           // Event being validated for
}
```

#### List Events Response

```typescript
interface ListEventsResponse {
  events: Event[];
  nextToken?: string;        // Pagination token
  totalCount: number;
}
```

### Error Response Model

```typescript
interface ErrorResponse {
  error: {
    code: string;            // Machine-readable error code
    message: string;         // Human-readable error message
    details?: any;           // Additional error context
    correlationId: string;   // X-Ray trace ID for debugging
  };
}
```

**Standard Error Codes**:
- `VALIDATION_ERROR` - Invalid input data (400)
- `UNAUTHORIZED` - Missing or invalid JWT token (401)
- `FORBIDDEN` - Insufficient permissions (403)
- `NOT_FOUND` - Resource not found (404)
- `CONFLICT` - Resource conflict (e.g., event sold out) (409)
- `PAYMENT_FAILED` - Payment processing error (402)
- `INTERNAL_ERROR` - Unexpected server error (500)
- `SERVICE_UNAVAILABLE` - Downstream service failure (503)

