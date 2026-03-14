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
}).refine((data: Record<string, unknown>) => Object.keys(data).length > 0, {
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
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.issues[0].message);
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