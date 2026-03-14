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