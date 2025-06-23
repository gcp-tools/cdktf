/**
 * API Gateway Construct
 *
 * This Construct creates an API Gateway with regional instances and a backend service, supporting:
 * - Multi-region deployment
 * - Health checks
 * - Serverless NEGs for each region
 *
 * Usage example:
 * ```typescript
 * const stack = new ApiGatewayConstruct(this, {
 *   regions: ['us-central1', 'us-east1'],
 *   apiGatewayConfig: {
 *     displayName: 'My API',
 *     openapiDocuments: [{
 *       document: {
 *         contents: 'openapi: 3.0.0\n...',
 *         path: 'openapi.yaml'
 *       }
 *     }]
 *   }
 * });
 * ```
 */

import {
  googleApiGatewayApi,
  googleApiGatewayApiConfig,
  googleApiGatewayGateway,
  googleComputeRegionNetworkEndpointGroup,
} from '@cdktf/provider-google-beta'
import { ServiceAccountIamMember } from '@cdktf/provider-google/lib/service-account-iam-member/index.js'
import { Fn } from 'cdktf'
import { envConfig } from '../utils/env.mjs'
import type { IngressStack } from '../stacks/ingress-stack.mjs'
import { BaseIngressConstruct } from './base-ingress-construct.mjs'

export type CloudRunServiceConfig = {
  key: string
  name: string
  uri: string
}

export type ApiGatewayConfig = {
  cloudRunServices: CloudRunServiceConfig[]
  displayName: string
  openApiTemplatePath: string
  region: string
}

export class ApiGatewayConstruct extends BaseIngressConstruct<ApiGatewayConfig> {
  public readonly apiGateway: googleApiGatewayApi.GoogleApiGatewayApi
  public readonly apiConfig: googleApiGatewayApiConfig.GoogleApiGatewayApiConfigA
  public readonly apiGatewayInstance: googleApiGatewayGateway.GoogleApiGatewayGateway
  public readonly serverlessNeg: googleComputeRegionNetworkEndpointGroup.GoogleComputeRegionNetworkEndpointGroup

  constructor(scope: IngressStack, id: string, config: ApiGatewayConfig) {
    super(scope, id, config)

    const deployerActAsIngressSa = new ServiceAccountIamMember(
      this,
      this.id('deployer', 'act', 'as', 'ingress', 'sa'),
      {
        serviceAccountId: scope.stackServiceAccount.id,
        role: 'roles/iam.serviceAccountUser',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
        provider: scope.googleProvider,
      },
    )

    this.apiGateway = new googleApiGatewayApi.GoogleApiGatewayApi(
      this,
      this.id('api'),
      {
        apiId: this.id('api'),
        displayName: config.displayName,
        project: scope.hostProjectId,
        provider: scope.googleBetaProvider,
      },
    )

    const templateVars = config.cloudRunServices.reduce(
      (acc, service) => {
        acc[service.key] = service.uri
        return acc
      },
      {} as Record<string, string>,
    )

    this.apiConfig = new googleApiGatewayApiConfig.GoogleApiGatewayApiConfigA(
      this,
      this.id('config'),
      {
        api: this.apiGateway.apiId,
        apiConfigId: this.id('config'),
        openapiDocuments: [
          {
            document: {
              contents: Fn.base64encode(
                Fn.templatefile(config.openApiTemplatePath, templateVars),
              ),
              path: 'openapi.yaml',
            },
          },
        ],
        gatewayConfig: {
          backendConfig: {
            googleServiceAccount: scope.stackServiceAccount.email,
          },
        },
        project: scope.hostProjectId,
        provider: scope.googleBetaProvider,
        dependsOn: [deployerActAsIngressSa],
      },
    )

    this.apiGatewayInstance = new googleApiGatewayGateway.GoogleApiGatewayGateway(
      this,
      this.id('gateway'),
        {
          apiConfig: this.apiConfig.id,
          gatewayId: this.id('gateway'),
          project: scope.hostProjectId,
          region: config.region,
          displayName: `${config.displayName} - ${config.region}`,
          provider: scope.googleBetaProvider,
        },
      )

    this.serverlessNeg =
      new googleComputeRegionNetworkEndpointGroup.GoogleComputeRegionNetworkEndpointGroup(
        this,
        this.id('neg'),
        {
          name: this.id('neg'),
          networkEndpointType: 'SERVERLESS',
          region: config.region,
          project: scope.hostProjectId,
          serverlessDeployment: {
            platform: 'apigateway.googleapis.com',
            resource: this.apiGatewayInstance.gatewayId,
          },
          provider: scope.googleBetaProvider,
        },
      )

  }
}
