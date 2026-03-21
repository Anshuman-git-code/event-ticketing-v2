import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
  // From DatabaseStack
  eventsTable: dynamodb.Table;
  registrationsTable: dynamodb.Table;
  ticketsTable: dynamodb.Table;
  // From StorageStack
  ticketsBucket: s3.Bucket;
  // From MessagingStack
  ticketGenerationQueue: sqs.Queue;
  // From AuthStack
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  // From FoundationStack
  webAcl: wafv2.CfnWebACL;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ==========================================
    // Shared Lambda configuration
    // ==========================================
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE, // X-Ray tracing
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: ['@aws-sdk/*'],
        forceDockerBundling: false,
      },
    };

    // Shared environment variables injected into every Lambda
    const commonEnv = {
      EVENTS_TABLE: props.eventsTable.tableName,
      REGISTRATIONS_TABLE: props.registrationsTable.tableName,
      TICKETS_TABLE: props.ticketsTable.tableName,
      TICKETS_BUCKET: props.ticketsBucket.bucketName,
      TICKET_QUEUE_URL: props.ticketGenerationQueue.queueUrl,
      LOG_LEVEL: 'INFO',
      POWERTOOLS_METRICS_NAMESPACE: 'EventTicketing',
    };

    // ==========================================
    // Lambda Functions
    // ==========================================

    const createEventFn = new NodejsFunction(this, 'CreateEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/createEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'createEvent' },
    });

    const listEventsFn = new NodejsFunction(this, 'ListEventsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/listEvents/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'listEvents' },
    });

    const getEventFn = new NodejsFunction(this, 'GetEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getEvent' },
    });

    const updateEventFn = new NodejsFunction(this, 'UpdateEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/updateEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'updateEvent' },
    });

    const deleteEventFn = new NodejsFunction(this, 'DeleteEventFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/deleteEvent/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'deleteEvent' },
    });

    const createRegistrationFn = new NodejsFunction(this, 'CreateRegistrationFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/createRegistration/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'createRegistration' },
    });

    const getMyRegistrationsFn = new NodejsFunction(this, 'GetMyRegistrationsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getMyRegistrations/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getMyRegistrations' },
    });

    const getEventRegistrationsFn = new NodejsFunction(this, 'GetEventRegistrationsFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getEventRegistrations/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getEventRegistrations' },
    });

    const generateTicketFn = new NodejsFunction(this, 'GenerateTicketFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/generateTicket/index.ts'),
      handler: 'handler',
      memorySize: 512,                      // PDF generation needs more RAM
      timeout: cdk.Duration.seconds(60),    // PDF + S3 upload takes longer
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'generateTicket' },
      bundling: {
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
        externalModules: ['@aws-sdk/*'],
        // pdfkit and qrcode use CJS internals that esbuild can't tree-shake cleanly
        // nodeModules copies them into the bundle as-is
        nodeModules: ['pdfkit', 'qrcode'],
      },
    });

    const getTicketDownloadFn = new NodejsFunction(this, 'GetTicketDownloadFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/getTicketDownload/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'getTicketDownload' },
    });

    const validateTicketFn = new NodejsFunction(this, 'ValidateTicketFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '../../lambda/validateTicket/index.ts'),
      handler: 'handler',
      environment: { ...commonEnv, POWERTOOLS_SERVICE_NAME: 'validateTicket' },
    });

    // ==========================================
    // IAM Permissions (least privilege per Lambda)
    // ==========================================
    props.eventsTable.grantWriteData(createEventFn);
    props.eventsTable.grantReadData(listEventsFn);
    props.eventsTable.grantReadData(getEventFn);
    props.eventsTable.grantReadWriteData(updateEventFn);
    props.eventsTable.grantReadWriteData(deleteEventFn);
    props.registrationsTable.grantReadData(deleteEventFn);
    props.eventsTable.grantReadWriteData(createRegistrationFn);
    props.registrationsTable.grantReadWriteData(createRegistrationFn);
    props.ticketGenerationQueue.grantSendMessages(createRegistrationFn);
    props.registrationsTable.grantReadData(getMyRegistrationsFn);
    props.eventsTable.grantReadData(getEventRegistrationsFn);
    props.registrationsTable.grantReadData(getEventRegistrationsFn);
    props.eventsTable.grantReadData(generateTicketFn);
    props.registrationsTable.grantReadWriteData(generateTicketFn);
    props.ticketsTable.grantReadWriteData(generateTicketFn);
    props.ticketsBucket.grantWrite(generateTicketFn);
    props.ticketsTable.grantReadData(getTicketDownloadFn);
    props.ticketsBucket.grantRead(getTicketDownloadFn);
    props.ticketsTable.grantReadWriteData(validateTicketFn);

    // ==========================================
    // SQS → generateTicket event source (not an HTTP route)
    // ==========================================
    generateTicketFn.addEventSource(
      new lambdaEventSources.SqsEventSource(props.ticketGenerationQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    // ==========================================
    // HTTP API Gateway
    // ==========================================
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.projectName}-api-${props.environment}`,
      description: 'Event Ticketing V2 API',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          'http://localhost:5173',
          'https://dgwpgtk36nw9c.cloudfront.net',
        ],
        maxAge: cdk.Duration.days(1),
      },
    });

    // ==========================================
    // Cognito JWT Authorizer
    // ==========================================
    const authorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      }
    );

    // Helper: wrap a Lambda in an HTTP integration
    const integration = (fn: lambda.IFunction) =>
      new apigatewayv2Integrations.HttpLambdaIntegration(`${fn.node.id}Integration`, fn);

    // ==========================================
    // Routes — Public (no auth)
    // ==========================================
    this.httpApi.addRoutes({
      path: '/v1/events',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(listEventsFn),
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getEventFn),
    });

    // ==========================================
    // Routes — Protected (JWT required)
    // ==========================================
    this.httpApi.addRoutes({
      path: '/v1/events',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(createEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.PUT],
      integration: integration(updateEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: integration(deleteEventFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/registrations',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(createRegistrationFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/registrations/my',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getMyRegistrationsFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/registrations',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getEventRegistrationsFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/tickets/{ticketId}/download',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: integration(getTicketDownloadFn),
      authorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/tickets/validate',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: integration(validateTicketFn),
      authorizer,
    });

    // NOTE: WAF association with HTTP API v2 is not supported via CfnWebACLAssociation.
    // HTTP API Gateway v2 does not have a standard ARN format for WAF association.
    // The WAF WebACL is deployed and can be associated manually if needed,
    // or via CloudFront in Phase 5 when we add the CDN layer.
    // new wafv2.CfnWebACLAssociation(this, 'ApiWafAssociation', { ... });

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API Gateway URL — use this as your base URL',
      exportName: `${props.projectName}-${props.environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      exportName: `${props.projectName}-${props.environment}-api-id`,
    });
  }
}
