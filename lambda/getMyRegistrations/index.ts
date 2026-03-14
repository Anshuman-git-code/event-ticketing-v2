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