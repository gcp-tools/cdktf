/**
 * API Gateway Infrastructure Stack
 *
 * This stack creates an API Gateway with regional instances and a backend service, supporting:
 * - Multi-region deployment
 * - Health checks
 * - Serverless NEGs for each region
 *
 * Usage example:
 * ```typescript
 * const stack = new ApiGatewayStack(app, {
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
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type ApiGatewayStackConfig = {
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

// const envConfig = {
//   bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
//   regions: envVars.GCP_TOOLS_REGIONS,
// }

export class ApiGatewayStack extends BaseInfraStack<ApiGatewayStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected networkInfraRemoteState: DataTerraformRemoteStateGcs
  protected apiGateway: googleApiGatewayApi.GoogleApiGatewayApi
  protected apiConfig: googleApiGatewayApiConfig.GoogleApiGatewayApiConfigA
  protected apiGatewayInstances: googleApiGatewayGateway.GoogleApiGatewayGateway[]
  protected backendService: computeBackendService.ComputeBackendService
  protected healthChecks: computeHealthCheck.ComputeHealthCheck[]
  protected serverlessNegs: computeRegionNetworkEndpointGroup.ComputeRegionNetworkEndpointGroup[]

  constructor(scope: App, config: ApiGatewayStackConfig) {
    super(scope, 'api-gateway', config)

    // Get remote state for app project and network
    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.networkInfraRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'network'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infrastructure', 'network'),
      },
    )

    const appProjectId = this.appProjectRemoteState.getString('project-id')
    // const vpcId = this.networkInfraRemoteState.getString('vpc-id')

    // Create API Gateway
    this.apiGateway = new googleApiGatewayApi.GoogleApiGatewayApi(
      this,
      this.id('api', 'gateway'),
      {
        apiId: this.id('api'),
        displayName: config.apiGatewayConfig.displayName,
        project: appProjectId,
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
        project: appProjectId,
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
          project: appProjectId,
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
          project: appProjectId,
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
            project: appProjectId,
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
        project: appProjectId,
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
