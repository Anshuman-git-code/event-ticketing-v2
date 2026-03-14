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
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.issues[0].message);
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