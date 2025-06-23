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

import { readFileSync } from 'node:fs'
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

    const openApiTpl = readFileSync(config.openApiTemplatePath, 'utf-8')

    const openApiSpec = config.cloudRunServices.reduce(
      (spec, service) =>
        spec.replace(new RegExp(`\\$\\{${service.key}\\}`, 'g'), service.uri),
      openApiTpl,
    )

    this.apiGateway = new googleApiGatewayApi.GoogleApiGatewayApi(
      this,
      this.id('api'),
      {
        apiId: this.id('api'),
        displayName: config.displayName,
        project: scope.hostProjectId,
      },
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
              contents: Buffer.from(openApiSpec).toString('base64'),
              path: 'openapi.yaml',
            },
          },
        ],
        project: scope.hostProjectId,
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
            resource: this.apiGatewayInstance.id,
          },
        },
      )

  }
}
