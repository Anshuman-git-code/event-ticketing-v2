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