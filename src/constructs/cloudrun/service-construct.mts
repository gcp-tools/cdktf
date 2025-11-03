/**
 * CloudRunServiceConstruct - Simplified implementation for deploying
 * containerized applications to Cloud Run using pre-built images.
 *
 * This construct expects images to be built and pushed to Artifact Registry
 * before Terraform runs (typically in GitHub Actions). It focuses solely on
 * provisioning and configuring the Cloud Run service.
 */
import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
import { CloudRunV2Service } from '@cdktf/provider-google/lib/cloud-run-v2-service/index.js'
import type { ITerraformDependable } from 'cdktf'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'

export type CloudRunServiceConstructConfig = {
  /**
   * Pre-built image URI from GitHub Actions.
   * Format: {region}-docker.pkg.dev/{project}/{repo}/{service}:{tag}
   */
  imageUri: string
  /**
   * The GCP region where the service should be deployed (e.g., 'us-central1')
   */
  region: string
  serviceConfig: {
    dependsOn?: ITerraformDependable[]
    grantInvokerPermissions?: string[]
    environmentVariables?: Record<string, string>
    cpu?: string
    memory?: string
    maxScale?: number
    minScale?: number
    containerPort?: number
    containerConcurrency?: number
    timeoutSeconds?: number
    egress?: 'ALL_TRAFFIC' | 'PRIVATE_RANGES_ONLY'
  }
}

export class CloudRunServiceConstruct extends BaseAppConstruct<CloudRunServiceConstructConfig> {
  public service: CloudRunV2Service
  public imageUri: string

  constructor(
    scope: AppStack,
    id: string,
    config: CloudRunServiceConstructConfig,
  ) {
    super(scope, id, config)

    const { imageUri, region, serviceConfig } = config
    const {
      dependsOn = [],
      grantInvokerPermissions = [],
      environmentVariables = {},
      cpu = '1000m',
      memory = '512Mi',
      minScale = 0,
      maxScale = 10,
      containerPort = 8080,
      containerConcurrency = 80,
      timeoutSeconds = 60,
      egress = 'PRIVATE_RANGES_ONLY',
    } = serviceConfig

    const serviceId = this.id('service')
    this.imageUri = imageUri

    // --- Cloud Run Service ---
    this.service = new CloudRunV2Service(this, serviceId, {
      name: serviceId,
      location: region,
      project: scope.projectId,
      deletionProtection: false,
      template: {
        scaling: { minInstanceCount: minScale, maxInstanceCount: maxScale },
        ...(scope.vpcConnector === 'configured'
          ? {
              vpcAccess: {
                connector: scope.vpcConnectorId,
                egress,
              },
            }
          : {}),
        maxInstanceRequestConcurrency: containerConcurrency,
        timeout: `${timeoutSeconds}s`,
        serviceAccount: scope.stackServiceAccount.email,
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        containers: [
          {
            image: this.imageUri,
            ports: { containerPort },
            resources: { limits: { cpu, memory } },
            env: Object.entries(environmentVariables).map(([name, value]) => ({
              name,
              value,
            })),
            startupProbe: {
              tcpSocket: { port: containerPort },
              initialDelaySeconds: 15,
              timeoutSeconds: 10,
              periodSeconds: 15,
              failureThreshold: 5,
            },
            livenessProbe: {
              httpGet: { path: '/health', port: containerPort },
              initialDelaySeconds: 10,
              timeoutSeconds: 1,
              periodSeconds: 10,
              failureThreshold: 3,
            },
          },
        ],
      },
      traffic: [
        { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 },
      ],
      dependsOn,
    })

    // --- Service Invoker IAM ---
    new CloudRunServiceIamBinding(this, this.id('binding', 'invoker'), {
      location: region,
      project: scope.projectId,
      service: this.service.name,
      role: 'roles/run.invoker',
      members: [
        `serviceAccount:${scope.stackServiceAccount.email}`,
        ...grantInvokerPermissions,
      ],
      dependsOn: [this.service],
    })
  }
}
