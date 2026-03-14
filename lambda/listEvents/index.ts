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