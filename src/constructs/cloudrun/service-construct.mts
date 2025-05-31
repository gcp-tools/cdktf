/**
 * CloudRunServiceConstruct - Deploy containerized applications to Cloud Run
 *
 * This construct provides infrastructure for building and deploying containerized
 * applications to Google Cloud Run from source code, including:
 * - Source code packaging and upload to Cloud Storage
 * - Artifact Registry repository for container images
 * - Automated container builds using Cloud Build
 * - Cloud Run service deployment with proper IAM
 * - VPC connector support for private networking
 *
 * This construct automatically builds containers using Cloud Build as part of
 * the deployment process from your source code directory.
 *
 * @example
 * // Deploy web application with automated build
 * const webApp = new cloudrun.CloudRunServiceConstruct(this, 'web-app', {
 *   buildConfig: {
 *     sourceDir: './my-app',
 *     dockerfile: 'Dockerfile',
 *     buildArgs: {
 *       NODE_ENV: 'production'
 *     }
 *   },
 *   environmentVariables: {
 *     DATABASE_URL: 'postgresql://user:pass@host:5432/db',
 *     API_KEY: 'your-api-key'
 *   },
 *   cpu: '2000m',
 *   memory: '1Gi',
 *   maxScale: 50,
 *   minScale: 1,
 *   vpcConnector: scope.vpcConnectorId,
 *   vpcConnectorEgressSettings: 'PRIVATE_RANGES_ONLY'
 * })
 *
 * // Container is automatically built and deployed with `cdktf deploy`
 *
 * @example
 * // Deploy API service with custom build configuration
 * const apiService = new cloudrun.CloudRunServiceConstruct(this, 'api', {
 *   buildConfig: {
 *     sourceDir: './backend',
 *     dockerfile: 'api.Dockerfile',
 *     buildArgs: {
 *       PORT: '8080',
 *       ENV: 'production'
 *     },
 *     timeout: '15m',
 *     machineType: 'E2_HIGHCPU_32'
 *   },
 *   environmentVariables: {
 *     DATABASE_URL: 'postgresql://...',
 *     REDIS_URL: 'redis://...'
 *   },
 *   containerPort: 8080,
 *   cpu: '1000m',
 *   memory: '512Mi'
 * })
 *
 * @example
 * // Access the deployed service URL
 * const serviceUrl = webApp.service.status.get(0).url
 *
 * @requires Dockerfile - Your sourceDir must contain a Dockerfile
 * @requires gcloud CLI - Must be authenticated and configured on deployment machine
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'
import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file/index.js'
import { ArtifactRegistryRepository } from '@cdktf/provider-google/lib/artifact-registry-repository/index.js'
import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
import { CloudRunService } from '@cdktf/provider-google/lib/cloud-run-service/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
import type { ITerraformDependable } from 'cdktf'
import { LocalExec } from 'cdktf-local-exec'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { envConfig } from '../../utils/env.mjs'
import { BaseConstruct } from '../base-construct.mjs'

const sourceDirectory = resolve(cwd(), '..', 'services')

export type CloudRunServiceConstructConfig = {
  // Build configuration for local source code
  buildConfig: {
    sourceDir?: string // Local source directory (default: ../services/{stackId}/{id})
    dockerfile?: string // Path to Dockerfile relative to sourceDir (default: Dockerfile)
    buildArgs?: Record<string, string> // Docker build arguments
    timeout?: string // Build timeout (default: 10m)
    machineType?: string // Cloud Build machine type (default: E2_HIGHCPU_8)
  }

  // Service configuration
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

  // VPC configuration
  vpcConnector?: string
  vpcConnectorEgressSettings?: 'ALL_TRAFFIC' | 'PRIVATE_RANGES_ONLY'
}

export class CloudRunServiceConstruct<
  T extends CloudRunServiceConstructConfig,
> extends BaseConstruct<CloudRunServiceConstructConfig> {
  protected repository: ArtifactRegistryRepository
  protected bucket: StorageBucket
  protected archive: StorageBucketObject
  protected archiveFile: DataArchiveFile
  protected buildStep: LocalExec
  protected cloudBuildServiceAccountBinding: ProjectIamMember
  protected invoker: CloudRunServiceIamBinding
  public service: CloudRunService
  public imageUri: string

  constructor(scope: AppStack, id: string, config: T) {
    super(scope, id, config)

    const serviceId = this.id('service')

    // Determine source directory
    const sourceDir = config.buildConfig.sourceDir
      ? resolve(config.buildConfig.sourceDir)
      : resolve(sourceDirectory, scope.stackId, id)

    // Create Artifact Registry repository
    const repositoryId = this.id('repo')
    this.repository = new ArtifactRegistryRepository(this, repositoryId, {
      repositoryId: repositoryId.toLowerCase(),
      format: 'DOCKER',
      location: envConfig.region,
      project: scope.projectId,
      description: `Container repository for ${serviceId}`,
      dependsOn: config.dependsOn || [],
    })

    // Create storage bucket for source code
    const bucketId = this.id('source', 'bucket')
    this.bucket = new StorageBucket(this, bucketId, {
      dependsOn: [
        scope.stackServiceAccount,
        this.repository,
        ...(config.dependsOn || []),
      ],
      forceDestroy: true,
      location: envConfig.region,
      name: bucketId,
      project: scope.projectId,
      uniformBucketLevelAccess: true,
      versioning: {
        enabled: true,
      },
    })

    // Grant service account access to bucket
    new StorageBucketIamBinding(this, this.id('bucket', 'iam', 'admin'), {
      bucket: this.bucket.name,
      dependsOn: [this.bucket],
      members: [`serviceAccount:${scope.stackServiceAccount.email}`],
      role: 'roles/storage.admin',
    })

    // Package source code
    const outputPath = resolve(
      '.',
      'cdktf.out',
      'stacks',
      `${scope.projectId}`,
      'assets',
      `${this.constructId}.zip`,
    )

    this.archiveFile = new DataArchiveFile(this, this.id('archive', 'file'), {
      outputPath,
      sourceDir,
      type: 'zip',
    })

    this.archive = new StorageBucketObject(this, this.id('archive'), {
      bucket: this.bucket.name,
      dependsOn: [this.bucket],
      name: this.archiveFile.outputMd5,
      source: this.archiveFile.outputPath,
    })

    // Grant Cloud Build service account access to push to Artifact Registry
    this.cloudBuildServiceAccountBinding = new ProjectIamMember(
      this,
      this.id('cloudbuild', 'registry', 'writer'),
      {
        project: scope.projectId,
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        dependsOn: [this.repository],
      },
    )

    // Grant Cloud Build access to the source bucket
    new StorageBucketIamBinding(
      this,
      this.id('cloudbuild', 'bucket', 'reader'),
      {
        bucket: this.bucket.name,
        dependsOn: [this.bucket],
        members: [
          `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        ],
        role: 'roles/storage.objectViewer',
      },
    )

    this.imageUri = `${envConfig.region}-docker.pkg.dev/${scope.projectId}/${this.repository.name}/${serviceId}:latest`

    // Create Cloud Build step using LocalExec
    this.buildStep = new LocalExec(this, this.id('build', 'step'), {
      dependsOn: [this.archive, this.cloudBuildServiceAccountBinding],
      cwd: process.cwd(),
      command: this.generateBuildCommand(scope.projectId, config.buildConfig),
    })

    // Create Cloud Run service
    this.service = new CloudRunService(this, serviceId, {
      name: serviceId,
      location: envConfig.region,
      project: scope.projectId,
      template: {
        metadata: {
          annotations: {
            'autoscaling.knative.dev/maxScale': (
              config.maxScale || 100
            ).toString(),
            'autoscaling.knative.dev/minScale': (
              config.minScale || 0
            ).toString(),
            ...(config.vpcConnector
              ? {
                  'run.googleapis.com/vpc-access-connector':
                    config.vpcConnector,
                  'run.googleapis.com/vpc-access-egress':
                    config.vpcConnectorEgressSettings || 'PRIVATE_RANGES_ONLY',
                }
              : {}),
          },
        },
        spec: {
          containerConcurrency: config.containerConcurrency || 40,
          timeoutSeconds: config.timeoutSeconds || 300,
          serviceAccountName: scope.stackServiceAccount.email,
          containers: [
            {
              image: this.imageUri,
              ports: [
                {
                  containerPort: config.containerPort || 8080,
                },
              ],
              resources: {
                limits: {
                  cpu: config.cpu || '1000m',
                  memory: config.memory || '512Mi',
                },
              },
              env: Object.entries(config.environmentVariables || {}).map(
                ([name, value]) => ({
                  name,
                  value,
                }),
              ),
            },
          ],
        },
      },
      timeouts: {
        create: '20m', // Longer timeout to allow for container build
        update: '10m',
        delete: '5m',
      },
      dependsOn: [this.buildStep],
    })

    // Set up IAM bindings for invoking the service
    this.invoker = new CloudRunServiceIamBinding(
      this,
      this.id('binding', 'invoker'),
      {
        location: envConfig.region,
        project: scope.projectId,
        service: this.service.name,
        role: 'roles/run.invoker',
        members: [
          `serviceAccount:${scope.stackServiceAccount.email}`,
          `serviceAccount:service-${scope.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`,
          ...(config.grantInvokerPermissions || []),
        ],
        dependsOn: [this.service],
      },
    )
  }

  private generateBuildCommand(
    projectId: string,
    buildConfig: NonNullable<T['buildConfig']>,
  ): string {
    const dockerfile = buildConfig.dockerfile || 'Dockerfile'
    const timeout = buildConfig.timeout || '600s'
    const machineType = buildConfig.machineType || 'E2_HIGHCPU_8'

    // Build arguments for docker build
    const buildArgsLines = Object.entries(buildConfig.buildArgs || {})
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')

    // Read and substitute template
    const currentDir = dirname(fileURLToPath(import.meta.url))
    const templatePath = resolve(currentDir, 'cloudbuild.template.yaml')
    const template = readFileSync(templatePath, 'utf-8')

    const cloudbuildYaml = template
      .replace(/\{\{BUCKET_NAME\}\}/g, this.bucket.name)
      .replace(/\{\{ARCHIVE_NAME\}\}/g, this.archive.name)
      .replace(/\{\{IMAGE_URI\}\}/g, this.imageUri)
      .replace(
        /\{\{IMAGE_URI_WITH_BUILD_ID\}\}/g,
        this.imageUri.replace(':latest', ':$BUILD_ID'),
      )
      .replace(/\{\{DOCKERFILE\}\}/g, dockerfile)
      .replace(/\{\{BUILD_ARGS\}\}/g, buildArgsLines)
      .replace(/\{\{MACHINE_TYPE\}\}/g, machineType)
      .replace(/\{\{TIMEOUT\}\}/g, timeout)

    return `
      echo "Starting Cloud Build for container..."

      # Ensure gcloud is configured
      gcloud config set project ${projectId}

      # Create temporary cloudbuild.yaml
      cat > /tmp/cloudbuild-${this.constructId}.yaml << 'EOF'
${cloudbuildYaml}
EOF

      # Submit build
      gcloud builds submit --no-source --config=/tmp/cloudbuild-${this.constructId}.yaml --project=${projectId}

      # Cleanup
      rm -f /tmp/cloudbuild-${this.constructId}.yaml

      echo "✅ Container build completed successfully!"
    `.trim()
  }
}
