/**
 * CloudRunServiceConstructAlt - An alternative implementation for deploying
 * containerized applications to Cloud Run, with a strong focus on debugging
 * and transparent error reporting for the build process.
 *
 * This construct provides the same functionality as the original but uses a
 * different approach for the build step to help diagnose CI/CD issues.
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
import type { ITerraformDependable } from 'cdktf'
import { LocalExec } from 'cdktf-local-exec'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { envConfig } from '../../utils/env.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'

const sourceDirectory = resolve(cwd(), '..', '..', 'services')

export type CloudRunServiceConstructConfig = {
  buildConfig: {
    buildArgs?: Record<string, string>
    timeout?: string
    machineType?: string
  }
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
    imageRetentionCount?: number
  }
}

export class CloudRunServiceConstructAlt<
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
  protected iamBindingForDeployerBuilds: ProjectIamMember

  constructor(scope: AppStack, id: string, config: T) {
    super(scope, id, config)

    const { buildConfig, region, serviceConfig } = config
    const {
      timeout: buildTimeout = '1200s',
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
    const sourceDir = resolve(sourceDirectory, scope.stackId)
    // const dockerfile = 'Dockerfile'

    // --- Artifact Registry Repository ---

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


    const repositoryId = this.id('repo')
    this.repository = new ArtifactRegistryRepository(this, repositoryId, {
      repositoryId: repositoryId.toLowerCase(),
      format: 'DOCKER',
      location: region,
      project: scope.projectId,
      description: `Container repository for ${serviceId}`,
      dependsOn,
      cleanupPolicies,
    })

    // --- Source Code Storage ---
    const bucketId = this.id('source', 'bucket')
    this.bucket = new StorageBucket(this, bucketId, {
      dependsOn: [scope.stackServiceAccount, this.repository, ...dependsOn],
      forceDestroy: true,
      location: region,
      name: bucketId,
      project: scope.projectId,
      uniformBucketLevelAccess: true,
    })
    const outputPath = resolve(
      '.', 'cdktf.out', 'stacks', `${scope.projectId}`, 'assets', `${this.constructId}.zip`,
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

    // --- IAM Permissions ---
    this.iamBindingForDeployerBuilds = new ProjectIamMember(
      this, this.id('deployer', 'cloudbuild', 'builder'), {
        project: scope.projectId,
        role: 'roles/cloudbuild.builds.builder',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )
    this.cloudBuildServiceAccountBinding = new ProjectIamMember(
      this, this.id('cloudbuild', 'registry', 'writer'), {
        project: scope.projectId,
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        dependsOn: [this.repository],
      },
    )
    new StorageBucketIamBinding(
      this, this.id('cloudbuild', 'bucket', 'reader'), {
        bucket: this.bucket.name,
        dependsOn: [this.bucket],
        members: [`serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`],
        role: 'roles/storage.objectViewer',
      },
    )
    const deployerBinding = new ServiceAccountIamBinding(
      this, this.id('deployer', 'sa', 'user'), {
        serviceAccountId: scope.stackServiceAccount.id,
        role: 'roles/iam.serviceAccountUser',
        members: [`serviceAccount:${envConfig.deployerSaEmail}`],
      },
    )

    // --- Image URI ---
    this.imageUri = `${region}-docker.pkg.dev/${scope.projectId}/${this.repository.name}/${serviceId}:latest`

    // --- Cloud Build YAML ---
    const buildArgsLines = Object.entries(buildArgs)
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')
    const imageUriWithBuildId = this.imageUri.replace(':latest', ':$BUILD_ID')
    const cloudbuildYaml = `
steps:
  - name: 'gcr.io/cloud-builders/gsutil'
    args: ['cp', 'gs://${this.bucket.name}/${this.archive.name}', '/workspace/source.zip']
  - name: 'ubuntu'
    args: ['unzip', '/workspace/source.zip', '-d', '/workspace/src']
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - '${this.imageUri}'
      - '-t'
      - '${imageUriWithBuildId}'
      - '-f'
      - '/workspace/src/DOCKERFILE'
${buildArgsLines}
      - '/workspace/src'
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${this.imageUri}']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${imageUriWithBuildId}']
options:
  machineType: ${machineType}
  timeout: ${buildTimeout}
  logging: CLOUD_LOGGING_ONLY
`

    // --- LocalExec Build Step ---
    this.buildStep = new LocalExec(this, this.id('build-debug-step'), {
      dependsOn: [
        this.archive,
        this.cloudBuildServiceAccountBinding,
        this.iamBindingForDeployerBuilds,
      ],
      command: `
        # Strict mode and command tracing
        set -euxo pipefail

        echo "--- DIAGNOSTICS ---"
        echo "Executing as user: $(whoami)"
        echo "--- gcloud auth list ---"
        gcloud auth list
        echo "--- gcloud config list ---"
        gcloud config list --all
        echo "--- Environment Variables ---"
        env
        echo "--- END DIAGNOSTICS ---"

        CLOUDBUILD_CONFIG=$(mktemp)
        trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT

        echo "--- Writing Build Config ---"
        # Use a "here document" to safely write the YAML to a temp file.
        cat > "$CLOUDBUILD_CONFIG" <<EOF
${cloudbuildYaml}
EOF

        echo "--- Build Config Contents ---"
        cat "$CLOUDBUILD_CONFIG"
        echo "--- End Build Config ---"

        echo "Submitting build..."
        gcloud builds submit --no-source --config="$CLOUDBUILD_CONFIG" --project=${scope.projectId}
      `,
    })

    // --- Image Propagation Delay ---
    const imagePropagationDelay = new LocalExec(this, this.id('image-propagation-delay'), {
      dependsOn: [this.buildStep],
      command: `
        for i in {1..5}; do
          echo "Attempt $i to find image..."
          if gcloud container images describe ${this.imageUri} --project=${scope.projectId}; then
            echo "Image found!"
            exit 0
          fi
          echo "Waiting 30 seconds..."
          sleep 30
        done
        echo "Image not found after 5 attempts."
        exit 1
      `,
    })

    // --- Cloud Run Service ---
    this.service = new CloudRunV2Service(this, serviceId, {
      name: serviceId,
      location: region,
      project: scope.projectId,
      deletionProtection: false,
      template: {
        scaling: { minInstanceCount: minScale, maxInstanceCount: maxScale },
        vpcAccess: { connector: scope.vpcConnectorId, egress: 'ALL_TRAFFIC' },
        maxInstanceRequestConcurrency: containerConcurrency,
        timeout: `${timeoutSeconds}s`,
        serviceAccount: scope.stackServiceAccount.email,
        containers: [{
          image: this.imageUri,
          ports: { containerPort },
          resources: { limits: { cpu, memory } },
          env: Object.entries(environmentVariables).map(([name, value]) => ({ name, value })),
          startupProbe: { tcpSocket: { port: containerPort } },
          livenessProbe: { httpGet: { path: '/health', port: containerPort } },
        }],
      },
      traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
      dependsOn: [imagePropagationDelay, deployerBinding],
    })

    // --- Service Invoker IAM ---
    this.invoker = new CloudRunServiceIamBinding(
      this, this.id('binding', 'invoker'), {
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
}
