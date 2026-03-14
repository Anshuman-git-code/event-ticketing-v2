import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const logger = new Logger({ serviceName: 'generateTicket' });
const tracer = new Tracer({ serviceName: 'generateTicket' });
const metrics = new Metrics({ namespace: 'EventTicketing', serviceName: 'generateTicket' });

const ddbClient = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(new DynamoDBClient({}))
);
const s3Client = tracer.captureAWSv3Client(new S3Client({}));

// Process each SQS message
async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { registrationId, eventId, userId, userName, userEmail, eventName, eventDate, eventLocation } = message;

  logger.info('Processing ticket generation', { registrationId, eventId });

  // 1. Check if ticket already exists (idempotency)
  const existingTicket = await ddbClient.send(new GetCommand({
    TableName: process.env.TICKETS_TABLE!,
    Key: { ticketId: registrationId },  // Use registrationId as ticketId for idempotency
  }));

  if (existingTicket.Item) {
    logger.info('Ticket already exists, skipping', { registrationId });
    return;
  }

  // 2. Generate QR code as base64 PNG
  const qrPayload = JSON.stringify({
    ticketId: registrationId,
    eventId,
    userId,
    timestamp: new Date().toISOString(),
  });
  const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 200 });
  // Extract base64 data (remove "data:image/png;base64," prefix)
  const qrCodeBase64 = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');

  // 3. Generate PDF
  const pdfBuffer = await generatePDF({
    ticketId: registrationId,
    eventName,
    eventDate: new Date(eventDate).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    eventLocation,
    attendeeName: userName,
    attendeeEmail: userEmail,
    qrCodeBase64,
  });

  // 4. Upload PDF to S3
  const s3Key = `tickets/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${registrationId}.pdf`;

  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.TICKETS_BUCKET!,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    Metadata: {
      registrationId,
      eventId,
      userId,
    },
  }));

  // 5. Save ticket record to DynamoDB
  const now = new Date().toISOString();
  const ticketItem = {
    ticketId: registrationId,
    registrationId,
    eventId,
    userId,
    qrCode: qrCodeBase64,
    status: 'generated',
    generatedAt: now,
    s3Key,
    eventName,
    eventDate,
    eventLocation,
    attendeeName: userName,
  };

  await ddbClient.send(new PutCommand({
    TableName: process.env.TICKETS_TABLE!,
    Item: ticketItem,
    ConditionExpression: 'attribute_not_exists(ticketId)',
  }));

  // 6. Update registration with ticketId
  await ddbClient.send(new UpdateCommand({
    TableName: process.env.REGISTRATIONS_TABLE!,
    Key: { registrationId },
    UpdateExpression: 'SET ticketId = :ticketId, #updatedAt = :now',
    ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
    ExpressionAttributeValues: { ':ticketId': registrationId, ':now': now },
  }));

  metrics.addMetric('TicketGenerated', MetricUnit.Count, 1);
  logger.info('Ticket generated successfully', { registrationId, s3Key });
}

// Helper: Generate PDF buffer
async function generatePDF(data: {
  ticketId: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  attendeeName: string;
  attendeeEmail: string;
  qrCodeBase64: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold').text('EVENT TICKET', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Event details
    doc.fontSize(20).font('Helvetica-Bold').text(data.eventName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica').text(`Date: ${data.eventDate}`, { align: 'center' });
    doc.text(`Location: ${data.eventLocation}`, { align: 'center' });
    doc.moveDown(1.5);

    // Attendee details
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text('ATTENDEE');
    doc.font('Helvetica').text(data.attendeeName);
    doc.text(data.attendeeEmail);
    doc.moveDown(1);

    // QR Code
    const qrBuffer = Buffer.from(data.qrCodeBase64, 'base64');
    doc.image(qrBuffer, { fit: [150, 150], align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Ticket ID: ${data.ticketId}`, { align: 'center' });

    doc.end();
  });
}

// SQS handler — processes batch of messages
export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing SQS batch', { messageCount: event.Records.length });

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error('Failed to process record', { messageId: record.messageId, error });
      // Re-throw to let SQS retry this message (up to maxReceiveCount=3, then DLQ)
      throw error;
    }
  }

  metrics.publishStoredMetrics();
};