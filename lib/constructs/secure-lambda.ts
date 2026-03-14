import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface SecureLambdaProps {
  /** Function name (will be prefixed with project/env) */
  functionName: string;
  /** Path to the Lambda handler code */
  entry: string;
  /** Handler method (default: index.handler) */
  handler?: string;
  /** Environment variables for the function */
  environment?: Record<string, string>;
  /** Memory in MB (default: 256) */
  memorySize?: number;
  /** Timeout (default: 30 seconds) */
  timeout?: cdk.Duration;
  /** Project name for naming/tagging */
  projectName: string;
  /** Environment (dev/prod) */
  environment_name: string;
}

/**
 * SecureLambda construct - opinionated Lambda with:
 * - X-Ray tracing enabled
 * - Lambda Powertools layer
 * - Dedicated log group with 30-day retention
 * - Dead Letter Queue for failed invocations
 * - Per-function IAM role (least privilege)
 * - ARM64 architecture (cheaper + faster)
 */
export class SecureLambda extends Construct {
  public readonly function: lambda.Function;
  public readonly role: iam.Role;
  public readonly dlq: sqs.Queue;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SecureLambdaProps) {
    super(scope, id);

    // Dedicated log group with retention
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${props.projectName}-${props.functionName}-${props.environment_name}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dead Letter Queue for failed async invocations
    this.dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `${props.projectName}-${props.functionName}-dlq-${props.environment_name}`,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Per-function IAM role
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Execution role for ${props.functionName} Lambda`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
      ],
    });

    // Allow writing to DLQ
    this.dlq.grantSendMessages(this.role);

    // Lambda function
    this.function = new lambda.Function(this, 'Function', {
      functionName: `${props.projectName}-${props.functionName}-${props.environment_name}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: props.handler ?? 'index.handler',
      code: lambda.Code.fromAsset(props.entry),
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE, // X-Ray enabled
      role: this.role,
      logGroup: this.logGroup,
      deadLetterQueue: this.dlq,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: props.functionName,
        POWERTOOLS_LOG_LEVEL: 'INFO',
        ...props.environment,
      },
    });
  }
}
