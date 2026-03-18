import * as iam from 'aws-cdk-lib/aws-iam';
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
  public readonly githubActionsRole: iam.Role;
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

    // ==========================================
    // GitHub Actions OIDC Provider
    // ==========================================
    // Allows GitHub Actions to authenticate to AWS without stored credentials
    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      // GitHub's OIDC thumbprint — this is a fixed value, not a secret
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    // ==========================================
    // GitHub Actions IAM Role
    // ==========================================
    // This role is assumed by GitHub Actions workflows
    this.githubActionsRole = new iam.Role(this, 'GitHubActionsRole', {
      roleName: `${props.projectName}-github-actions-${props.environment}`,
      description: 'Role assumed by GitHub Actions for CDK deployments',
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          // Only allow workflows from YOUR repository
          'StringEquals': {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          // Allow both main branch pushes and PRs from your repo
          'StringLike': {
            'token.actions.githubusercontent.com:sub':
              `repo:Anshuman-git-code/event-ticketing-v2:*`,
          },
        }
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Grant permissions needed for CDK deployments
    // PowerUserAccess covers all CDK operations except IAM user management
    this.githubActionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess')
    );

    // CDK also needs to pass roles to services (Lambda, API Gateway, etc.)
    this.githubActionsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole', 'iam:CreateRole', 'iam:AttachRolePolicy',
        'iam:DetachRolePolicy', 'iam:DeleteRole', 'iam:PutRolePolicy',
        'iam:DeleteRolePolicy', 'iam:GetRole', 'iam:TagRole'],
      resources: [`arn:aws:iam::${this.account}:role/${props.projectName}-*`],
    }));

    // Output the role ARN — you'll need this for the GitHub workflow
    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: this.githubActionsRole.roleArn,
      description: 'Copy this ARN into your GitHub Actions workflow',
      exportName: `${props.projectName}-${props.environment}-github-actions-role-arn`,
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