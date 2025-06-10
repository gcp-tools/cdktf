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
} from '@cdktf/provider-google-beta'

import {
  computeBackendService,
  computeHealthCheck,
  computeRegionNetworkEndpointGroup,
} from '@cdktf/provider-google'
import { TerraformOutput } from 'cdktf'
import { envConfig } from '../utils/env.mjs'
import { BaseIngressConstruct } from './base-ingress-construct.mjs'
import type { IngressStack } from '../stacks/ingress-stack.mjs'

export type ApiGatewayConfig = {
  // regions: string[]
  apiGatewayConfig: {
    displayName: string
    openapiDocuments: {
      document: {
        contents: string
        path: string
      }
    }[]
  }
}

export class ApiGatewayConstruct extends BaseIngressConstruct<ApiGatewayConfig> {
  protected apiGateway: googleApiGatewayApi.GoogleApiGatewayApi
  protected apiConfig: googleApiGatewayApiConfig.GoogleApiGatewayApiConfigA
  protected apiGatewayInstances: googleApiGatewayGateway.GoogleApiGatewayGateway[]
  protected backendService: computeBackendService.ComputeBackendService
  protected healthChecks: computeHealthCheck.ComputeHealthCheck[]
  protected serverlessNegs: computeRegionNetworkEndpointGroup.ComputeRegionNetworkEndpointGroup[]

  constructor(scope: IngressStack, config: ApiGatewayConfig) {
    super(scope, 'api-gateway', config)

    // Create API Gateway
    this.apiGateway = new googleApiGatewayApi.GoogleApiGatewayApi(
      this,
      this.id('api', 'gateway'),
      {
        apiId: this.id('api'),
        displayName: config.apiGatewayConfig.displayName,
        project: scope.hostProjectId,
      },
    )

    this.apiConfig = new googleApiGatewayApiConfig.GoogleApiGatewayApiConfigA(
      this,
      this.id('api', 'config'),
      {
        api: this.apiGateway.apiId,
        apiConfigId: this.id('config'),
        openapiDocuments: config.apiGatewayConfig.openapiDocuments.map(
          (doc) => ({
            document: {
              contents: doc.document.contents,
              path: doc.document.path,
            },
          }),
        ),
        project: scope.hostProjectId,
      },
    )

    // Initialize arrays for region-specific resources
    this.apiGatewayInstances = []
    this.healthChecks = []
    this.serverlessNegs = []

    // Create region-specific resources in a single loop
    for (const [index, region] of envConfig.regions.entries()) {
      // Create API Gateway instance
      const gateway = new googleApiGatewayGateway.GoogleApiGatewayGateway(
        this,
        `gateway-${index}`,
        {
          apiConfig: this.apiConfig.id,
          gatewayId: this.id('gateway', region),
          project: scope.hostProjectId,
          region,
          displayName: `${config.apiGatewayConfig.displayName} - ${region}`,
        },
      )
      this.apiGatewayInstances.push(gateway)

      // Create health check
      const healthCheck = new computeHealthCheck.ComputeHealthCheck(
        this,
        `health-check-${index}`,
        {
          name: this.id('health-check', region),
          project: scope.hostProjectId,
          httpHealthCheck: {
            port: 80,
            requestPath: '/health',
          },
        },
      )
      this.healthChecks.push(healthCheck)

      // Create Serverless NEG
      const neg =
        new computeRegionNetworkEndpointGroup.ComputeRegionNetworkEndpointGroup(
          this,
          `neg-${index}`,
          {
            name: this.id('neg', region),
            networkEndpointType: 'SERVERLESS',
            region,
            project: scope.hostProjectId,
            cloudRun: {
              service: gateway.name,
            },
          },
        )
      this.serverlessNegs.push(neg)
    }

    // Create a single backend service with all NEGs
    this.backendService = new computeBackendService.ComputeBackendService(
      this,
      this.id('backend', 'service'),
      {
        name: this.id('backend-service'),
        project: scope.hostProjectId,
        healthChecks: this.healthChecks.map((check) => check.id),
        loadBalancingScheme: 'EXTERNAL',
        protocol: 'HTTP',
        timeoutSec: 30,
        portName: 'http',
        backend: this.serverlessNegs.map((neg) => ({
          group: neg.id,
        })),
      },
    )

    // Outputs
    new TerraformOutput(this, 'api-gateway-id', {
      value: this.apiGateway.apiId,
    })

    new TerraformOutput(this, 'backend-service-id', {
      value: this.backendService.id,
    })

    new TerraformOutput(this, 'backend-service-name', {
      value: this.backendService.name,
    })
  }
}
