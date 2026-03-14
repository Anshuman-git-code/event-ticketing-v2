import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  projectName: string;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ==========================================
    // HTTP API Gateway (v2 - cheaper and faster than REST API)
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
        allowOrigins: ['*'], // TODO: Week 5 - restrict to CloudFront domain
        maxAge: cdk.Duration.days(1),
      },
    });

    // TODO: Week 3 - Add Lambda integrations and routes
    // TODO: Week 3 - Add Cognito JWT authorizer
    // TODO: Week 4 - Associate WAF WebACL

    // Tags
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `${props.projectName}-${props.environment}-api-url`,
    });
  }
}
