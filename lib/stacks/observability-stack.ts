import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  // Your email address for alarm notifications
  alarmEmail?: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ==========================================
    // SNS Topic for alarm notifications
    // ==========================================
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${props.projectName}-alarms-${props.environment}`,
      displayName: 'Event Ticketing Alarms',
    });

    // Subscribe your email to receive alarm notifications
    if (props.alarmEmail) {
      this.alarmTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.alarmEmail)
      );
    }

    // ==========================================
    // Helper: create a standard alarm
    // ==========================================
    const createAlarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
      comparisonOperator = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    ) => {
      const alarm = new cloudwatch.Alarm(this, id, {
        alarmName: `${props.projectName}-${props.environment}-${id}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 2,        // Must breach for 2 consecutive periods
        datapointsToAlarm: 2,        // Both periods must breach
        comparisonOperator,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
      alarm.addOkAction(new cloudwatchActions.SnsAction(this.alarmTopic));
      return alarm;
    };

    // ==========================================
    // API Gateway Metrics
    // ==========================================
    const apiId = cdk.Fn.importValue(
      `${props.projectName}-${props.environment}-api-id`
    );

    const api5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiLatencyP99 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: { ApiId: apiId },
      statistic: 'p99',
      period: cdk.Duration.minutes(5),
    });

    const apiCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // Lambda Metrics (per function)
    // ==========================================
    const lambdaFunctions = [
      'CreateEventFn', 'ListEventsFn', 'GetEventFn', 'UpdateEventFn',
      'DeleteEventFn', 'CreateRegistrationFn', 'GetMyRegistrationsFn',
      'GetEventRegistrationsFn', 'GenerateTicketFn', 'GetTicketDownloadFn',
      'ValidateTicketFn',
    ];

    const lambdaErrorMetrics = lambdaFunctions.map(fn =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: `${props.projectName}-${fn}-${props.environment}` },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      })
    );

    const lambdaDurationMetrics = lambdaFunctions.map(fn =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: { FunctionName: `${props.projectName}-${fn}-${props.environment}` },
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      })
    );

    // ==========================================
    // SQS Metrics
    // ==========================================
    const sqsQueueName = `${props.projectName}-ticket-generation-${props.environment}.fifo`;
    const sqsDlqName = `${props.projectName}-ticket-generation-dlq-${props.environment}.fifo`;

    const sqsQueueDepth = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: { QueueName: sqsQueueName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    const sqsDlqDepth = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: { QueueName: sqsDlqName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // DynamoDB Metrics
    // ==========================================
    const dynamoThrottledReads = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ReadThrottleEvents',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const dynamoThrottledWrites = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'WriteThrottleEvents',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // ==========================================
    // Alarms
    // ==========================================
    const api5xxAlarm = createAlarm('Api5xxAlarm', api5xxMetric, 5,
      'API Gateway 5xx errors exceeded 5 in 5 minutes — Lambda may be crashing');

    const apiLatencyAlarm = createAlarm('ApiLatencyAlarm', apiLatencyP99, 1000,
      'API Gateway p99 latency exceeded 1 second — investigate slow Lambdas');

    const sqsDlqAlarm = createAlarm('SqsDlqAlarm', sqsDlqDepth, 1,
      'Messages in ticket generation DLQ — ticket generation is failing');

    const dynamoThrottleAlarm = createAlarm('DynamoThrottleAlarm',
      new cloudwatch.MathExpression({
        expression: 'reads + writes',
        usingMetrics: { reads: dynamoThrottledReads, writes: dynamoThrottledWrites },
        period: cdk.Duration.minutes(5),
      }),
      1,
      'DynamoDB throttling detected — consider increasing capacity or adding caching'
    );

    // ==========================================
    // CloudWatch Dashboard
    // ==========================================
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${props.projectName}-${props.environment}`,
    });

    this.dashboard.addWidgets(
      // Row 1: API Gateway overview
      new cloudwatch.TextWidget({
        markdown: '## API Gateway',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Request Count',
        left: [apiCountMetric],
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: '5xx Errors',
        left: [api5xxMetric],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: '4xx Errors',
        left: [api4xxMetric],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Latency p99 (ms)',
        left: [apiLatencyP99],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      })
    );

    this.dashboard.addWidgets(
      // Row 2: Lambda overview
      new cloudwatch.TextWidget({
        markdown: '## Lambda Functions',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors (all functions)',
        left: lambdaErrorMetrics,
        leftYAxis: { min: 0 },
        width: 12, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration p95 (ms)',
        left: lambdaDurationMetrics,
        leftYAxis: { min: 0 },
        width: 12, height: 6,
      })
    );

    this.dashboard.addWidgets(
      // Row 3: SQS and DynamoDB
      new cloudwatch.TextWidget({
        markdown: '## SQS Queue & DynamoDB',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Ticket Queue Depth',
        left: [sqsQueueDepth],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DLQ Depth (should be 0)',
        left: [sqsDlqDepth],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Reads',
        left: [dynamoThrottledReads],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Writes',
        left: [dynamoThrottledWrites],
        leftYAxis: { min: 0 },
        width: 6, height: 6,
      })
    );

    // Alarm status widget — shows all alarms at a glance
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## Alarm Status',
        width: 24, height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'All Alarms',
        alarms: [api5xxAlarm, apiLatencyAlarm, sqsDlqAlarm, dynamoThrottleAlarm],
        width: 24, height: 4,
      })
    );

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${props.projectName}-${props.environment}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS Topic ARN for alarm notifications',
    });
  }
}