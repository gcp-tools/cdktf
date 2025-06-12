/**
 * CloudRunServiceConstruct - Deploy containerized applications to Cloud Run
 *
 * This construct provides infrastructure for building and deploying containerized
 * applications to Google Cloud Run from a conventional source code directory
 * (`../services/{stack-id}`). It includes:
 * - Source code packaging and upload to Cloud Storage
 * - A dedicated Artifact Registry repository for each service's container images
 * - Automated container builds using Cloud Build
 * - Cloud Run service deployment with proper IAM and service identity
 * - Automatic integration with the stack's VPC connector for private networking
 *
 * @example
 * // Deploy a production-ready web application with sensible defaults
 * new cloudrun.CloudRunServiceConstruct(this, 'web-app', {
 *   region: 'us-central1',
 *   buildConfig: {
 *     machineType: 'E2_HIGHCPU_8', // Override default
 *   },
 *   serviceConfig: {
 *     environmentVariables: {
 *       NODE_ENV: 'production',
 *     },
 *     minScale: 1, // Keep one instance warm to prevent cold starts
 *     grantInvokerPermissions: ['serviceAccount:another-service@...'],
 *   },
 * })
 *
 * @example
 * // Deploy an API with custom resource limits
 * new cloudrun.CloudRunServiceConstruct(this, 'api-service', {
 *   region: 'us-central1',
 *   buildConfig: {},
 *   serviceConfig: {
 *     containerPort: 8080,
 *     cpu: '2000m', // 2 vCPU
 *     memory: '1Gi',
 *   },
 * })
 *
 * @example
 * // Access the deployed service URL
 * const serviceUrl = webApp.service.status.get(0).url
 *
 * @requires Dockerfile - Your source directory must contain a Dockerfile
 * @requires gcloud CLI - Must be authenticated and configured on deployment machine
 */

import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file/index.js'
import { ArtifactRegistryRepository } from '@cdktf/provider-google/lib/artifact-registry-repository/index.js'
import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
import { CloudRunV2Service } from '@cdktf/provider-google/lib/cloud-run-v2-service/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
import type { ITerraformDependable } from 'cdktf'
import { LocalExec } from 'cdktf-local-exec'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'

const sourceDirectory = resolve(cwd(), '..', 'services')

export type CloudRunServiceConstructConfig = {
  // Build configuration for local source code
  buildConfig: {
    buildArgs?: Record<string, string>
    timeout?: string
    // The Cloud Build machine type. Defaults to a smallish machine to keep costs down
    // Override to a larger machine (e.g., 'E2_HIGHCPU_8') for production.
    machineType?: string
  }

  // Cloud Run configuration
  region: string

  // Service configuration
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
  }
}

export class CloudRunServiceConstruct<
  T extends CloudRunServiceConstructConfig,
> extends BaseAppConstruct<CloudRunServiceConstructConfig> {
  protected repository: ArtifactRegistryRepository
  protected bucket: StorageBucket
  protected archive: StorageBucketObject
  protected archiveFile: DataArchiveFile
  protected buildStep: LocalExec
  protected cloudBuildServiceAccountBinding: ProjectIamMember
  protected invoker: CloudRunServiceIamBinding
  public service: CloudRunV2Service
  public imageUri: string

  constructor(scope: AppStack, id: string, config: T) {
    super(scope, id, config)

    const { buildConfig, region, serviceConfig } = config

    const {
      timeout: buildTimeout = '600s',
      machineType = 'E2_MEDIUM',
      buildArgs = {},
    } = buildConfig

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
    } = serviceConfig

    const serviceId = this.id('service')

    // Determine source directory based on convention
    const sourceDir = resolve(sourceDirectory, scope.stackId)
    const dockerfile = 'Dockerfile'

    // Create Artifact Registry repository
    const repositoryId = this.id('repo')
    this.repository = new ArtifactRegistryRepository(this, repositoryId, {
      repositoryId: repositoryId.toLowerCase(),
      format: 'DOCKER',
      location: region,
      project: scope.projectId,
      description: `Container repository for ${serviceId}`,
      dependsOn,
    })

    // Create storage bucket for source code
    const bucketId = this.id('source', 'bucket')
    this.bucket = new StorageBucket(this, bucketId, {
      dependsOn: [scope.stackServiceAccount, this.repository, ...dependsOn],
      forceDestroy: true,
      location: region,
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

    this.imageUri = `${region}-docker.pkg.dev/${scope.projectId}/${this.repository.name}/${serviceId}:latest`

    // Create Cloud Build step using LocalExec
    this.buildStep = new LocalExec(this, this.id('build', 'step'), {
      dependsOn: [this.archive, this.cloudBuildServiceAccountBinding],
      cwd: process.cwd(),
      command: this.generateBuildCommand(scope.projectId, {
        dockerfile,
        timeout: buildTimeout,
        machineType,
        buildArgs,
      }),
    })

    // Create Cloud Run service
    this.service = new CloudRunV2Service(this, serviceId, {
      name: serviceId,
      location: region,
      project: scope.projectId,
      template: {
        scaling: {
          minInstanceCount: minScale,
          maxInstanceCount: maxScale,
        },
        vpcAccess: {
          connector: scope.vpcConnectorId,
          egress: 'ALL_TRAFFIC',
        },
        maxInstanceRequestConcurrency: containerConcurrency,
        timeout: `${timeoutSeconds}s`,
        serviceAccount: scope.stackServiceAccount.email,
        containers: [
          {
            image: this.imageUri,
            ports: {
              containerPort,
            },
            resources: {
              limits: {
                cpu,
                memory,
              },
            },
            env: Object.entries(environmentVariables).map(([name, value]) => ({
              name,
              value,
            })),
          },
        ],
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
      },
      timeouts: {
        create: '20m', // Longer timeout to allow for container build
        update: '10m',
        delete: '5m',
      },
      dependsOn: [this.buildStep as unknown as ITerraformDependable],
    })

    // Set up IAM bindings for invoking the service
    this.invoker = new CloudRunServiceIamBinding(
      this,
      this.id('binding', 'invoker'),
      {
        location: region,
        project: scope.projectId,
        service: this.service.name,
        role: 'roles/run.invoker',
        members: [
          `serviceAccount:${scope.stackServiceAccount.email}`,
          `serviceAccount:service-${scope.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`,
          ...grantInvokerPermissions,
        ],
        dependsOn: [this.service],
      },
    )
  }

  private generateBuildCommand(
    projectId: string,
    buildConfig: {
      dockerfile: string
      timeout: string
      machineType: string
      buildArgs: Record<string, string>
    },
  ): string {
    const { dockerfile, timeout, machineType, buildArgs } = buildConfig

    // Build arguments for docker build
    const buildArgsLines = Object.entries(buildArgs)
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')

    // Read and substitute template
    const cloudbuildYaml = cloudbuildTemplate
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


const cloudbuildTemplate = `
steps:
  # Download and extract source
  - name: 'gcr.io/cloud-builders/gsutil'
    args: ['cp', 'gs://{{BUCKET_NAME}}/{{ARCHIVE_NAME}}', '/workspace/source.zip']

  - name: 'ubuntu'
    args: ['unzip', '/workspace/source.zip', '-d', '/workspace/src']

  # Build Docker image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - '{{IMAGE_URI}}'
      - '-t'
      - '{{IMAGE_URI_WITH_BUILD_ID}}'
      - '-f'
      - '/workspace/src/{{DOCKERFILE}}'
{{BUILD_ARGS}}
      - '/workspace/src'

  # Push images
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '{{IMAGE_URI}}']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '{{IMAGE_URI_WITH_BUILD_ID}}']

options:
  machineType: '{{MACHINE_TYPE}}'
  logging: CLOUD_LOGGING_ONLY
timeout: '{{TIMEOUT}}'
`