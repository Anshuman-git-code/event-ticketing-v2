import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface FoundationStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class FoundationStack extends cdk.Stack {
  public readonly databaseEncryptionKey: kms.Key;
  public readonly storageEncryptionKey: kms.Key;
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    // KMS Key for DynamoDB encryption
    this.databaseEncryptionKey = new kms.Key(this, 'DatabaseEncryptionKey', {
      description: `${props.projectName} DynamoDB encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep key if stack deleted
    });

    // KMS Key for S3 encryption
    this.storageEncryptionKey = new kms.Key(this, 'StorageEncryptionKey', {
      description: `${props.projectName} S3 encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ==========================================
    // WAF WebACL — protects API Gateway and CloudFront
    // ==========================================
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${props.projectName}-waf-${props.environment}`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${props.projectName}-waf-${props.environment}`,
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
          },
        },
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSetMetric',
          },
        },
        {
          name: 'RateLimitRule',
          priority: 3,
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitMetric',
          },
        },
      ],
    });

    // VPC (optional - Lambdas can run without VPC)
    // Uncomment if you want VPC for future use
    /*
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // No NAT gateways to save cost
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    */

    // Tags for cost allocation
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseKeyArn', {
      value: this.databaseEncryptionKey.keyArn,
      exportName: `${props.projectName}-${props.environment}-db-key-arn`,
    });

    new cdk.CfnOutput(this, 'StorageKeyArn', {
      value: this.storageEncryptionKey.keyArn,
      exportName: `${props.projectName}-${props.environment}-storage-key-arn`,
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF WebACL ARN — used by API Gateway and CloudFront',
      exportName: `${props.projectName}-${props.environment}-waf-arn`,
    });
  }
}