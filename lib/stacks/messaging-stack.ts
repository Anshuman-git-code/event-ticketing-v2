import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class MessagingStack extends cdk.Stack {
  public readonly ticketGenerationQueue: sqs.Queue;
  public readonly ticketGenerationDLQ: sqs.Queue;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    // ==========================================
    // Dead Letter Queue (catches failed messages after 3 retries)
    // ==========================================
    this.ticketGenerationDLQ = new sqs.Queue(this, 'TicketGenerationDLQ', {
      queueName: `${props.projectName}-ticket-generation-dlq-${props.environment}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================
    // Main FIFO Queue for async ticket generation
    // ==========================================
    this.ticketGenerationQueue = new sqs.Queue(this, 'TicketGenerationQueue', {
      queueName: `${props.projectName}-ticket-generation-${props.environment}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(360), // Must be >= 6x Lambda timeout (60s * 6 = 360s)
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.ticketGenerationDLQ,
        maxReceiveCount: 3, // Retry 3 times before sending to DLQ
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================
    // EventBridge Custom Event Bus
    // ==========================================
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `${props.projectName}-events-${props.environment}`,
    });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'TicketQueueUrl', {
      value: this.ticketGenerationQueue.queueUrl,
      exportName: `${props.projectName}-${props.environment}-ticket-queue-url`,
    });

    new cdk.CfnOutput(this, 'TicketDLQUrl', {
      value: this.ticketGenerationDLQ.queueUrl,
      exportName: `${props.projectName}-${props.environment}-ticket-dlq-url`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      exportName: `${props.projectName}-${props.environment}-event-bus-name`,
    });
  }
}
