import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface SecureApiProps {
  /** API name */
  apiName: string;
  /** Project name for naming/tagging */
  projectName: string;
  /** Environment (dev/prod) */
  environment: string;
  /** Allowed CORS origins (default: ['*'] for dev) */
  allowedOrigins?: string[];
}

/**
 * SecureApi construct - opinionated HTTP API Gateway with:
 * - CORS configured
 * - Access logging to CloudWatch
 * - Throttling defaults
 * - TODO: WAF association (Week 4)
 * - TODO: Cognito JWT authorizer (Week 3)
 */
export class SecureApi extends Construct {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly accessLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SecureApiProps) {
    super(scope, id);

    // Access log group
    this.accessLogGroup = new logs.LogGroup(this, 'AccessLogs', {
      logGroupName: `/aws/apigateway/${props.projectName}-${props.apiName}-${props.environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // HTTP API
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.projectName}-${props.apiName}-${props.environment}`,
      description: `${props.projectName} API (${props.environment})`,
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: props.allowedOrigins ?? ['*'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });
  }
}
