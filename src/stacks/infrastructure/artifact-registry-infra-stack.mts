import { ArtifactRegistryRepository } from '@cdktf/provider-google/lib/artifact-registry-repository/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { App } from 'cdktf'
import { TerraformOutput } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import type { BaseStackConfig } from '../base-stack.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type ArtifactRegistryRepositoryConfig = {
  /**
   * The stack ID where the service is defined (e.g., 'jobs', 'api')
   */
  stackId: string
  /**
   * The service ID within the stack (e.g., 'api', 'worker')
   */
  serviceId: string
  /**
   * The GCP region where the repository should be created (e.g., 'us-central1')
   */
  region: string
  /**
   * Number of recent images to retain. Defaults to 10.
   * Set to 0 to disable cleanup policies.
   */
  imageRetentionCount?: number
}

export type ArtifactRegistryInfraStackConfig = BaseStackConfig & {
  /**
   * Array of artifact registry repository configurations
   */
  repositories: ArtifactRegistryRepositoryConfig[]
}

/**
 * Provisions Docker artifact registry repositories in the app project.
 *
 * This stack creates Artifact Registry Docker repositories that are required
 * before GitHub Actions can build and push container images. Each repository
 * is associated with a specific service and includes cleanup policies to
 * automatically manage old images.
 *
 * @example
 * ```ts
 * new ArtifactRegistryInfraStack(app, {
 *   repositories: [
 *     {
 *       stackId: 'jobs',
 *       serviceId: 'api',
 *       region: 'us-central1',
 *       imageRetentionCount: 10,
 *     },
 *     {
 *       stackId: 'api',
 *       serviceId: 'web',
 *       region: 'us-central1',
 *       imageRetentionCount: 20,
 *     },
 *   ],
 * })
 * ```
 */
export class ArtifactRegistryInfraStack extends BaseInfraStack<ArtifactRegistryInfraStackConfig> {
  constructor(scope: App, config: ArtifactRegistryInfraStackConfig) {
    super(scope, 'artifact-registry', config)

    const { repositories } = config

    // Get app project ID from remote state
    const appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app', 'project'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    const appProjectId = appProjectRemoteState.getString('project-id')

    // Create artifact registry repositories for each service
    for (const repoConfig of repositories) {
      const {
        stackId,
        serviceId,
        region,
        imageRetentionCount = 10,
      } = repoConfig

      // Generate repository ID matching CloudRunServiceConstruct pattern
      // Format: {projectName}-{env}-app-{stackId}-{serviceId}-repo
      const repositoryId =
        `${envConfig.projectName}-${envConfig.environment}-app-${stackId}-${serviceId}-repo`.toLowerCase()

      // Configure cleanup policies
      const cleanupPolicies =
        imageRetentionCount > 0
          ? [
              {
                id: `${serviceId}-keep-most-recent`.toLowerCase(),
                action: 'KEEP',
                condition: {
                  packageNamePrefixes: [serviceId.toLowerCase()],
                  tagState: 'ANY',
                  newerCountThan: imageRetentionCount,
                },
              },
              {
                id: `${serviceId}-delete-old-images`.toLowerCase(),
                action: 'DELETE',
                condition: {
                  packageNamePrefixes: [serviceId.toLowerCase()],
                  tagState: 'ANY',
                },
              },
            ]
          : undefined

      const repository = new ArtifactRegistryRepository(
        this,
        this.id(stackId, serviceId, 'repo'),
        {
          repositoryId,
          format: 'DOCKER',
          location: region,
          project: appProjectId,
          cleanupPolicies,
        },
      )

      // Output repository details for reference
      new TerraformOutput(this, `repo-${stackId}-${serviceId}-name`, {
        description: `Artifact registry repository name for ${stackId}/${serviceId}`,
        value: repository.name,
      })

      new TerraformOutput(this, `repo-${stackId}-${serviceId}-id`, {
        description: `Artifact registry repository ID for ${stackId}/${serviceId}`,
        value: repository.repositoryId,
      })
    }
  }
}
