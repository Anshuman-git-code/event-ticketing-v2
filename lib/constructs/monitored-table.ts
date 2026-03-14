import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface MonitoredTableProps {
  /** Table name (will be prefixed with project/env) */
  tableName: string;
  /** Partition key */
  partitionKey: dynamodb.Attribute;
  /** Sort key (optional) */
  sortKey?: dynamodb.Attribute;
  /** KMS encryption key */
  encryptionKey: kms.IKey;
  /** Project name for naming/tagging */
  projectName: string;
  /** Environment (dev/prod) */
  environment: string;
}

/**
 * MonitoredTable construct - opinionated DynamoDB table with:
 * - KMS customer-managed encryption
 * - Point-in-time recovery enabled
 * - DynamoDB Streams (NEW_AND_OLD_IMAGES)
 * - Pay-per-request billing
 * - CloudWatch alarms for throttling
 * - RETAIN removal policy (never accidentally delete data)
 */
export class MonitoredTable extends Construct {
  public readonly table: dynamodb.Table;
  public readonly throttleAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoredTableProps) {
    super(scope, id);

    // DynamoDB Table
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: `${props.projectName}-${props.tableName}-${props.environment}`,
      partitionKey: props.partitionKey,
      sortKey: props.sortKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.encryptionKey,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Alarm: any throttled requests = something is wrong
    this.throttleAlarm = new cloudwatch.Alarm(this, 'ThrottleAlarm', {
      alarmName: `${props.projectName}-${props.tableName}-throttle-${props.environment}`,
      alarmDescription: `DynamoDB throttling detected on ${props.tableName}`,
      metric: this.table.metricThrottledRequestsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.QUERY,
          dynamodb.Operation.UPDATE_ITEM,
        ],
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
