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
import { ServiceAccountIamBinding } from '@cdktf/provider-google/lib/service-account-iam-binding/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
// import { File } from '@cdktf/provider-local/lib/file/index.js'
import type { ITerraformDependable } from 'cdktf'
import { LocalExec } from 'cdktf-local-exec'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { envConfig } from '../../utils/env.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'

const sourceDirectory = resolve(cwd(), '..', '..', 'services')

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
    imageRetentionCount?: number
  }
}

export class CloudRunServiceConstruct<
  T extends CloudRunServiceConstructConfig,
> extends BaseAppConstruct<CloudRunServiceConstructConfig> {
  protected repository: ArtifactRegistryRepository
  protected bucket: StorageBucket
  protected archive: StorageBucketObject
  protected archiveFile: DataArchiveFile
  // protected buildConfigFile: File
  protected buildStep: LocalExec
  protected cloudBuildServiceAccountBinding: ProjectIamMember
  protected invoker: CloudRunServiceIamBinding
  public service: CloudRunV2Service
  public imageUri: string
  protected iamBindingForDeployerBuilds: ProjectIamMember

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
      imageRetentionCount = 10,
    } = serviceConfig

    const serviceId = this.id('service')

    // Determine source directory based on convention
    const sourceDir = resolve(sourceDirectory, scope.stackId)
    const dockerfile = 'Dockerfile'

    // Create Artifact Registry repository
    const repositoryId = this.id('repo')
    const cleanupPolicies =
      imageRetentionCount > 0
        ? [
            {
              id: 'keep-most-recent',
              action: 'KEEP',
              condition: {
                packageNamePrefixes: [serviceId.toLowerCase()],
                tagState: 'ANY',
                newerCountThan: imageRetentionCount,
              },
            },
            {
              id: 'delete-old-images',
              action: 'DELETE',
              condition: {
                packageNamePrefixes: [serviceId.toLowerCase()],
                tagState: 'ANY',
              },
            },
          ]
        : undefined

    this.repository = new ArtifactRegistryRepository(this, repositoryId, {
      repositoryId: repositoryId.toLowerCase(),
      format: 'DOCKER',
      location: region,
      project: scope.projectId,
      description: `Container repository for ${serviceId}`,
      dependsOn,
      cleanupPolicies,
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

    // Grant the deployer SA permission to create Cloud Builds. This is required
    // for the 'gcloud builds submit' command to succeed.
    this.iamBindingForDeployerBuilds = new ProjectIamMember(
      this,
      this.id('deployer', 'cloudbuild', 'editor'),
      {
        project: scope.projectId,
        role: 'roles/cloudbuild.builds.builder',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )

    // Grant the deployer SA permission to write logs.
    new ProjectIamMember(this, this.id('deployer', 'logging', 'writer'), {
      project: scope.projectId,
      role: 'roles/logging.logWriter',
      member: `serviceAccount:${envConfig.deployerSaEmail}`,
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

    // // Define path for the build config file
    // const buildConfigPath = resolve(
    //   '.',
    //   'cdktf.out',
    //   'build-configs',
    //   `${this.constructId}.yaml`,
    // )

    // Generate the content for the cloudbuild.yaml file
    const cloudbuildYaml = this.generateBuildYaml({
      dockerfile,
      timeout: buildTimeout,
      machineType,
      buildArgs,
    })

    // Create the build config file using the 'local' provider
    // this.buildConfigFile = new File(this, this.id('build', 'config', 'file'), {
    //   content: cloudbuildYaml,
    //   filename: buildConfigPath,
    // })

    // Create Cloud Build step using LocalExec. This implementation is designed
    // for simplicity and robust error reporting in a CI/CD environment.
    this.buildStep = new LocalExec(this, this.id('build', 'step'), {
      dependsOn: [
        this.archive,
        this.cloudBuildServiceAccountBinding,
        // Also depend on the deployer having the permission to create builds.
        this.iamBindingForDeployerBuilds,
      ],
      command: `
        # This script is designed to be robust and transparent.
        # -e: exits immediately if a command exits with a non-zero status.
        # -u: treats unset variables as an error.
        # -o pipefail: the return value of a pipeline is the status of
        #   the last command to exit with a non-zero status.
        set -euo pipefail

        # A temporary file is used for the build configuration.
        # 'mktemp' creates a secure temporary file.
        CLOUDBUILD_CONFIG=$(mktemp)

        # 'trap' ensures that the temporary file is deleted when the script exits,
        # whether it succeeds or fails.
        trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT

        echo "---"
        echo "Creating Cloud Build configuration at: $CLOUDBUILD_CONFIG"

        # A HERE document is used to safely write the multi-line
        # build configuration to the temporary file.
        cat > "$CLOUDBUILD_CONFIG" <<EOF
${cloudbuildYaml}
EOF

        echo "Submitting build to Google Cloud..."
        echo "---"

        # The 'gcloud builds submit' command is executed. If it fails,
        # 'set -e' will cause the script to exit immediately, and LocalExec
        # will report the failure, including the command's stdout and stderr.
        gcloud builds submit \\
          --no-source \\
          --project=${scope.projectId} \\
          --config="$CLOUDBUILD_CONFIG" \\
          --verbosity=info

        echo "---"
        echo "Build submitted successfully."
        echo "---"
      `,
    })

    // Add a delay to ensure image propagation with retries
    const imagePropagationDelay = new LocalExec(this, this.id('image', 'propagation', 'delay'), {
      dependsOn: [this.buildStep],
      command: `
        for i in {1..5}; do
          echo "Attempt $i: Checking if image exists..."
          if gcloud container images describe ${this.imageUri} --format="value(digest)" --project=${scope.projectId} 2>/dev/null; then
            echo "Image found!"
            exit 0
          fi
          echo "Image not found, waiting 30 seconds..."
          sleep 30
        done
        echo "Failed to find image after 5 attempts"
        exit 1
      `,
    })

    // Grant the deployer SA permission to act as the Cloud Run SA.
    // This is necessary for CI/CD pipelines where the deployer identity is different
    // from the service's runtime identity. The email is passed via an env var.
    const deployerBinding = new ServiceAccountIamBinding(
      this,
      this.id('deployer', 'sa', 'user'),
      {
        serviceAccountId: scope.stackServiceAccount.id,
        role: 'roles/iam.serviceAccountUser',
        members: [`serviceAccount:${envConfig.deployerSaEmail}`],
      },
    )

    const serviceDependencies: ITerraformDependable[] = [
      this.buildStep as unknown as ITerraformDependable,
      imagePropagationDelay as unknown as ITerraformDependable,
      deployerBinding,
      this.cloudBuildServiceAccountBinding,
      this.repository,
      this.archive
    ]

    // Create Cloud Run service
    this.service = new CloudRunV2Service(this, serviceId, {
      name: serviceId,
      location: region,
      project: scope.projectId,
      deletionProtection: false,
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
            startupProbe: {
              initialDelaySeconds: 0,
              timeoutSeconds: 1,
              periodSeconds: 3,
              failureThreshold: 1,
              tcpSocket: {
                port: containerPort
              }
            },
            livenessProbe: {
              initialDelaySeconds: 10,
              timeoutSeconds: 1,
              periodSeconds: 10,
              failureThreshold: 3,
              httpGet: {
                path: '/health',
                port: containerPort
              }
            }
          },
        ],
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
      },
      traffic: [
        {
          percent: 100,
          type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'
        }
      ],
      timeouts: {
        create: '20m', // Longer timeout to allow for container build
        update: '10m',
        delete: '5m',
      },
      dependsOn: serviceDependencies,
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

  private generateBuildYaml(buildConfig: {
    dockerfile: string
    timeout: string
    machineType: string
    buildArgs: Record<string, string>
  }): string {
    const { dockerfile, timeout, machineType, buildArgs } = buildConfig

    // Build arguments for docker build
    const buildArgsLines = Object.entries(buildArgs)
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')

    const imageUriWithBuildId = this.imageUri.replace(':latest', ':$BUILD_ID')

    // Read and substitute template
    return cloudbuildTemplate
      .replace(/\{\{BUCKET_NAME\}\}/g, this.bucket.name)
      .replace(/\{\{ARCHIVE_NAME\}\}/g, this.archive.name)
      .replace(/\{\{IMAGE_URI\}\}/g, this.imageUri)
      .replace(/\{\{IMAGE_URI_WITH_BUILD_ID\}\}/g, imageUriWithBuildId)
      .replace(/\{\{DOCKERFILE\}\}/g, dockerfile)
      .replace(/\{\{BUILD_ARGS\}\}/g, buildArgsLines)
      .replace(/\{\{MACHINE_TYPE\}\}/g, machineType)
      .replace(/\{\{TIMEOUT\}\}/g, timeout)
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
  machineType: {{MACHINE_TYPE}}
  logging: CLOUD_LOGGING_ONLY
  substitution_option: ALLOW_LOOSE
timeout: {{TIMEOUT}}
`
