import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ==========================================
    // Cognito User Pool
    // ==========================================
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.projectName}-users-${props.environment}`,

      // Users sign in with email address
      signInAliases: { email: true },
      signInCaseSensitive: false,

      // Users can register themselves
      selfSignUpEnabled: true,

      // Require email verification before account is active
      autoVerify: { email: true },

      // What info we collect at signup
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },

      // Password requirements
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },

      // Account recovery via email only
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Email verification settings
      userVerification: {
        emailSubject: 'Verify your Event Ticketing account',
        emailBody: 'Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },

      // Keep user pool if stack is deleted (NEVER lose user accounts!)
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ==========================================
    // User Pool Client (used by frontend app)
    // ==========================================
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${props.projectName}-web-client-${props.environment}`,

      // Auth flows supported
      authFlows: {
        userSrp: true,       // Secure Remote Password (recommended)
        userPassword: false, // Don't allow plain password auth
        adminUserPassword: false,
      },

      // Token expiry settings
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      // Don't generate client secret (not needed for browser apps)
      generateSecret: false,

      // Prevent user existence errors (security best practice)
      preventUserExistenceErrors: true,
    });

    // ==========================================
    // User Groups (for role-based access)
    // ==========================================

    // Organizers group — can create/manage events
    new cognito.CfnUserPoolGroup(this, 'OrganizersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Organizers',
      description: 'Event organizers who can create and manage events',
    });

    // Attendees group — can register for events
    new cognito.CfnUserPoolGroup(this, 'AttendeesGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Attendees',
      description: 'Event attendees who can register and get tickets',
    });

    // ==========================================
    // Store IDs in SSM Parameter Store
    // Lambda functions and frontend will read these
    // ==========================================
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/event-ticketing/${props.environment}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: `/event-ticketing/${props.environment}/cognito/client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${props.projectName}-${props.environment}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${props.projectName}-${props.environment}-user-pool-client-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN (needed for API Gateway authorizer)',
      exportName: `${props.projectName}-${props.environment}-user-pool-arn`,
    });
  }
}
