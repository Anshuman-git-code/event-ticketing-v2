import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  storageEncryptionKey: kms.IKey;
}

export class StorageStack extends cdk.Stack {
  public readonly ticketsBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;

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
