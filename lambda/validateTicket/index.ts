import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { successResponse, errorResponse } from '../types';

const logger = new Logger({ serviceName: 'validateTicket' });
const tracer = new Tracer({ serviceName: 'validateTicket' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'validateTicket' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);

const ValidateTicketSchema = z.object({
  qrCodeData: z.string().min(1),
  eventId: z.string().uuid(),
});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  logger.appendKeys({ requestId: event.requestContext.requestId });

  try {
    if (!event.body) return errorResponse(400, 'VALIDATION_ERROR', 'Request body is required');

    const parseResult = ValidateTicketSchema.safeParse(JSON.parse(event.body));
    if (!parseResult.success) {
      return errorResponse(400, 'VALIDATION_ERROR', parseResult.error.issues[0].message);
    }

    const { qrCodeData, eventId } = parseResult.data;

    // 1. Decode QR code payload
    let qrPayload: { ticketId: string; eventId: string; userId: string };
    try {
      qrPayload = JSON.parse(qrCodeData);
    } catch {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid QR code format');
    }

    // 2. Fetch ticket from DynamoDB
    const ticketResult = await ddbClient.send(new GetCommand({
      TableName: process.env.TICKETS_TABLE!,
      Key: { ticketId: qrPayload.ticketId },
    }));

    if (!ticketResult.Item) {
      return errorResponse(404, 'NOT_FOUND', 'Ticket not found');
    }

    const ticket = ticketResult.Item;

    // 3. Verify ticket is for the correct event
    if (ticket.eventId !== eventId) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Ticket is for a different event');
    }

    // 4. Mark ticket as validated (conditional — fails if already validated)
    const now = new Date().toISOString();
    try {
      await ddbClient.send(new UpdateCommand({
        TableName: process.env.TICKETS_TABLE!,
        Key: { ticketId: qrPayload.ticketId },
        UpdateExpression: 'SET #status = :validated, validatedAt = :now',
        ConditionExpression: '#status = :generated',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':validated': 'validated',
          ':generated': 'generated',
          ':now': now,
        },
      }));
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'CONFLICT', 'Ticket has already been validated');
      }
      throw error;
    }

    metrics.addMetric('TicketValidated', MetricUnit.Count, 1);
    logger.info('Ticket validated', { ticketId: qrPayload.ticketId, eventId });

    return successResponse(200, {
      valid: true,
      ticketId: qrPayload.ticketId,
      attendeeName: ticket.attendeeName,
      eventName: ticket.eventName,
      validatedAt: now,
    });

  } catch (error) {
    logger.error('Failed to validate ticket', { error });
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to validate ticket');
  } finally {
    metrics.publishStoredMetrics();
  }
};