/**
 * UI Infrastructure Stack
 *
 * This stack deploys a React application using Cloud Run, supporting:
 * - Container build and deployment
 * - Environment variable configuration
 * - VPC connector integration
 * - IAM configuration
 * - Custom domain mapping
 *
 * Usage example:
 * ```typescript
 * const stack = new UiStack(app, {
 *   appConfig: {
 *     name: 'my-react-app',
 *     region: 'us-central1',
 *     minInstances: 1,
 *     maxInstances: 10,
 *     memory: '512Mi',
 *     cpu: '1',
 *     env: {
 *       REACT_APP_API_URL: 'https://api.example.com',
 *       NODE_ENV: 'production'
 *     }
 *   },
 *   buildConfig: {
 *     sourceDir: './ui',
 *     dockerfile: 'Dockerfile',
 *     buildArgs: {
 *       NODE_ENV: 'production'
 *     }
 *   },
 *   domainConfig: {
 *     domain: 'app.example.com',
 *     certificate: true
 *   }
 * });
 * ```
 */

import {
  cloudRunDomainMapping,
  cloudRunService,
  cloudRunServiceIamMember,
} from '@cdktf/provider-google'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envVars } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type UiStackConfig = {
  appConfig: {
    name: string
    region: string
    minInstances?: number
    maxInstances?: number
    memory?: string
    cpu?: string
    env?: Record<string, string>
  }
  buildConfig: {
    sourceDir: string
    dockerfile?: string
    buildArgs?: Record<string, string>
  }
  domainConfig?: {
    domain: string
    certificate?: boolean
  }
  region: string
}

const envConfig = {
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
}

export class UiStack extends BaseInfraStack<UiStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected networkRemoteState: DataTerraformRemoteStateGcs
  protected cloudRunService: cloudRunService.CloudRunService
  protected domainMapping?: cloudRunDomainMapping.CloudRunDomainMapping
  protected iamBinding: cloudRunServiceIamMember.CloudRunServiceIamMember

  constructor(scope: App, config: UiStackConfig) {
    super(scope, 'ui', config)

    // Get remote state for app project and network
    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.networkRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'network'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infrastructure', 'network'),
      },
    )

    const appProjectId = this.appProjectRemoteState.getString('project-id')
    const vpcConnectorId = this.networkRemoteState.getString('vpc-connector-id')

    // Create Cloud Run service
    this.cloudRunService = new cloudRunService.CloudRunService(
      this,
      this.id('service'),
      {
        name: config.appConfig.name,
        location: config.appConfig.region,
        project: appProjectId,
        template: {
          spec: {
            containers: [
              {
                image: 'gcr.io/cloudrun/hello', // This will be replaced by the actual image after build
                resources: {
                  limits: {
                    memory: config.appConfig.memory || '512Mi',
                    cpu: config.appConfig.cpu || '1',
                  },
                },
                env: Object.entries(config.appConfig.env || {}).map(
                  ([key, value]) => ({
                    name: key,
                    value,
                  }),
                ),
              },
            ],
            containerConcurrency: 80,
          },
          metadata: {
            annotations: {
              'autoscaling.knative.dev/minScale': (
                config.appConfig.minInstances || 1
              ).toString(),
              'autoscaling.knative.dev/maxScale': (
                config.appConfig.maxInstances || 10
              ).toString(),
            },
          },
        },
        traffic: [
          {
            percent: 100,
            latestRevision: true,
          },
        ],
        metadata: {
          annotations: {
            'run.googleapis.com/vpc-access-connector': vpcConnectorId,
            'run.googleapis.com/vpc-access-egress': 'all',
          },
        },
      },
    )

    // Allow public access
    this.iamBinding = new cloudRunServiceIamMember.CloudRunServiceIamMember(
      this,
      this.id('public', 'access'),
      {
        location: config.appConfig.region,
        project: appProjectId,
        service: this.cloudRunService.name,
        role: 'roles/run.invoker',
        member: 'allUsers',
      },
    )

    // Create domain mapping if configured
    if (config.domainConfig) {
      this.domainMapping = new cloudRunDomainMapping.CloudRunDomainMapping(
        this,
        this.id('domain', 'mapping'),
        {
          location: config.appConfig.region,
          project: appProjectId,
          name: config.domainConfig.domain,
          metadata: {
            namespace: appProjectId,
          },
          spec: {
            routeName: this.cloudRunService.name,
          },
        },
      )
    }

    // Outputs
    new TerraformOutput(this, 'service-url', {
      value: this.cloudRunService.status.get(0).url,
    })

    if (this.domainMapping) {
      new TerraformOutput(this, 'domain-url', {
        value: this.domainMapping.status.get(0),
      })
    }
  }
}
