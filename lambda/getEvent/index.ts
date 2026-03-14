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