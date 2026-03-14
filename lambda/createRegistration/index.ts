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
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.issues[0].message);
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