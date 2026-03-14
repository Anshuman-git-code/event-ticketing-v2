import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ==========================================
    // CloudWatch Dashboard
    // ==========================================
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${props.projectName}-${props.environment}`,
    });

    // TODO: Week 4 - Add widgets for API Gateway, Lambda, DynamoDB, SQS metrics
    // TODO: Week 4 - Add CloudWatch Alarms
    // TODO: Week 4 - Add SNS topic for alarm notifications

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${props.projectName}-${props.environment}`,
      description: 'CloudWatch Dashboard URL',
    });
  }
}
