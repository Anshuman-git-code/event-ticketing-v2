import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  storageEncryptionKey: kms.IKey;
}

export class StorageStack extends cdk.Stack {
  public readonly ticketsBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // ==========================================
    // Tickets Bucket (stores generated PDF tickets)
    // ==========================================
    this.ticketsBucket = new s3.Bucket(this, 'TicketsBucket', {
      bucketName: `${props.projectName}-tickets-${props.environment}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.storageEncryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Delete old ticket versions after 7 days
          noncurrentVersionExpiration: cdk.Duration.days(7),
          id: 'DeleteOldVersions',
          enabled: true,
        },
      ],
    });

    // ==========================================
    // Frontend Bucket (hosts React app via CloudFront)
    // ==========================================
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${props.projectName}-frontend-${props.environment}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.storageEncryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Frontend can be redeployed
      autoDeleteObjects: true,
    });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // ==========================================
    // CloudFront Distribution for Frontend
    // ==========================================
    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      description: 'OAC for frontend bucket',
    });

    this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
          this.frontendBucket,
          { originAccessControl: oac }
        ),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      defaultRootObject: 'index.html',
      comment: `${props.projectName} frontend - ${props.environment}`,
    });

    this.frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [this.frontendBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        },
      },
    }));

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'CloudFront URL for the frontend',
      exportName: `${props.projectName}-${props.environment}-cloudfront-url`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID (needed for cache invalidation)',
    });

    // Outputs
    new cdk.CfnOutput(this, 'TicketsBucketName', {
      value: this.ticketsBucket.bucketName,
      exportName: `${props.projectName}-${props.environment}-tickets-bucket`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      exportName: `${props.projectName}-${props.environment}-frontend-bucket`,
    });
  }
}
