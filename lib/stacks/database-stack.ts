import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  databaseEncryptionKey: kms.IKey;
}

export class DatabaseStack extends cdk.Stack {
  // Expose tables so other stacks (ApiStack) can reference them
  public readonly eventsTable: dynamodb.Table;
  public readonly registrationsTable: dynamodb.Table;
  public readonly ticketsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // ==========================================
    // Events Table
    // ==========================================
    this.eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: `${props.projectName}-events-${props.environment}`,
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.databaseEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Events GSI 1: Query events by organizer
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'OrganizerIndex',
      partitionKey: { name: 'organizerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Events GSI 2: Query active events by date
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'DateIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Events GSI 3: Filter events by category
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Events GSI 4: Filter events by status
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // Registrations Table
    // ==========================================
    this.registrationsTable = new dynamodb.Table(this, 'RegistrationsTable', {
      tableName: `${props.projectName}-registrations-${props.environment}`,
      partitionKey: { name: 'registrationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.databaseEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Registrations GSI 1: Query registrations by user
    this.registrationsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'registeredAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Registrations GSI 2: Query registrations by event
    this.registrationsTable.addGlobalSecondaryIndex({
      indexName: 'EventIndex',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'registeredAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Registrations GSI 3: Idempotency checks
    this.registrationsTable.addGlobalSecondaryIndex({
      indexName: 'IdempotencyIndex',
      partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // Tickets Table
    // ==========================================
    this.ticketsTable = new dynamodb.Table(this, 'TicketsTable', {
      tableName: `${props.projectName}-tickets-${props.environment}`,
      partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.databaseEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Tickets GSI 1: Query tickets by user
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'generatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Tickets GSI 2: Query tickets by event
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'EventIndex',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'generatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Tickets GSI 3: QR code validation lookups
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'QRCodeIndex',
      partitionKey: { name: 'qrCode', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // Tags
    // ==========================================
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'EventsTableName', {
      value: this.eventsTable.tableName,
      exportName: `${props.projectName}-${props.environment}-events-table`,
    });

    new cdk.CfnOutput(this, 'RegistrationsTableName', {
      value: this.registrationsTable.tableName,
      exportName: `${props.projectName}-${props.environment}-registrations-table`,
    });

    new cdk.CfnOutput(this, 'TicketsTableName', {
      value: this.ticketsTable.tableName,
      exportName: `${props.projectName}-${props.environment}-tickets-table`,
    });
  }
}
