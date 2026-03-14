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