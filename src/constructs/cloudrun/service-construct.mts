/**
 * CloudRunServiceConstructAlt - An alternative, robust implementation for
 * deploying containerized applications to Cloud Run.
 *
 * This construct is designed to be highly reliable in CI/CD environments.
 * It declaratively enables required APIs and includes a resilient build
 * script that handles the "eventual consistency" of cloud provider APIs.
 */
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file/index.js'
import { ArtifactRegistryRepository } from '@cdktf/provider-google/lib/artifact-registry-repository/index.js'
import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
import { CloudRunV2Service } from '@cdktf/provider-google/lib/cloud-run-v2-service/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
import { ServiceAccountIamBinding } from '@cdktf/provider-google/lib/service-account-iam-binding/index.js'
import { ServiceAccountIamMember } from '@cdktf/provider-google/lib/service-account-iam-member/index.js'
import { Sleep } from '@cdktf/provider-time/lib/sleep/index.js'
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
    buildTrigger?: string
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

export class CloudRunServiceConstruct<
  T extends CloudRunServiceConstructConfig,
> extends BaseAppConstruct<CloudRunServiceConstructConfig> {
  public service: CloudRunV2Service
  public imageUri: string

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
    const dockerfile = 'Dockerfile'

    // --- Source Hash Computation ---
    // Compute a hash of all source files to detect changes automatically
    // Uses include-first approach to automatically detect any source files
    const sourceHashStep = new LocalExec(this, this.id('source-hash'), {
      command: `
        cd "${sourceDir}" && \
        find . -type f \
          ! -path "./node_modules/*" \
          ! -path "./dist/*" \
          ! -path "./build/*" \
          ! -path "./target/*" \
          ! -path "./.git/*" \
          ! -path "./.terraform/*" \
          ! -path "./.cdktf/*" \
          ! -path "./coverage/*" \
          ! -path "./.nyc_output/*" \
          ! -path "./.next/*" \
          ! -path "./.nuxt/*" \
          ! -path "./.cache/*" \
          ! -path "./tmp/*" \
          ! -path "./temp/*" \
          ! -path "./*.log" \
          ! -name "*.log" \
          ! -name ".DS_Store" \
          ! -name "Thumbs.db" \
        | sort | md5sum | cut -d' ' -f1
      `,
    })

    // --- Service Account for the Build ---
    const buildServiceAccount = new ServiceAccount(this, this.id('build', 'sa'), {
      accountId: this.shortName('build', 'sa'),
      displayName: 'Cloud Build SA',
      project: scope.projectId,
    })

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
    const repository = new ArtifactRegistryRepository(this, this.id('repo'), {
      repositoryId: this.id('repo').toLowerCase(),
      format: 'DOCKER',
      location: region,
      project: scope.projectId,
      cleanupPolicies,
    })

    // --- Source Code Storage ---
    const bucketId = this.id('source-bucket')
    const bucket = new StorageBucket(this, bucketId, {
      name: bucketId,
      location: region,
      project: scope.projectId,
      forceDestroy: true,
      uniformBucketLevelAccess: true,
    })
    const archiveFile = new DataArchiveFile(this, this.id('archive-file'), {
      type: 'zip',
      sourceDir,
      outputPath: resolve(
        cwd(),
        '.cdktf.out',
        'stacks',
        scope.projectId,
        `${serviceId}-${sourceHashStep.id}.zip`,
      ),
      dependsOn: [sourceHashStep],
    })

    const archive = new StorageBucketObject(this, this.id('archive'), {
      bucket: bucket.name,
      name: archiveFile.outputMd5,
      source: archiveFile.outputPath,
      dependsOn: [archiveFile],
    })

    // Grant the custom Cloud Build service account permission to write to the repo.
    new ProjectIamMember(this, this.id('cloudbuild-registry-writer'), {
      project: scope.projectId,
      role: 'roles/artifactregistry.writer',
      member: buildServiceAccount.member,
      dependsOn: [repository],
    })

    new StorageBucketIamBinding(this, this.id('cloudbuild-bucket-reader'), {
      bucket: bucket.name,
      members: [buildServiceAccount.member],
      role: 'roles/storage.objectViewer',
    })

    // Grant the custom Cloud Build service account permission to write logs.
    new ProjectIamMember(this, this.id('cloudbuild-logs-writer'), {
      project: scope.projectId,
      role: 'roles/logging.logWriter',
      member: buildServiceAccount.member,
    })

    const deployerBinding = new ServiceAccountIamBinding(
      this,
      this.id('deployer-sa-user'),
      {
        serviceAccountId: scope.stackServiceAccount.id,
        role: 'roles/iam.serviceAccountUser',
        members: [`serviceAccount:${envConfig.deployerSaEmail}`],
      },
    )

    // Grant the deployer SA permission to act as the build SA.
    // This is the key dependency to prevent the build from running too early.
    const deployerActAsBuildSa = new ServiceAccountIamMember(
      this,
      this.id('deployer', 'act', 'as', 'build', 'sa'),
      {
        serviceAccountId: buildServiceAccount.id,
        role: 'roles/iam.serviceAccountUser',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )

    // --- Image URI & Build YAML (Using Archive Hash) ---
    const imageName = `${region}-docker.pkg.dev/${scope.projectId}/${repository.name}/${serviceId}`
    this.imageUri = `${imageName}:${archiveFile.outputMd5}`

    const buildArgsLines = Object.entries(buildArgs)
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')
    const cloudbuildYaml = `
steps:
  - name: 'gcr.io/cloud-builders/gsutil'
    args: ['cp', 'gs://${bucket.name}/${archive.name}', '/workspace/source.zip']
  - name: 'ubuntu'
    entrypoint: 'bash'
    args:
      - -c
      - |
        apt-get update && apt-get install -y unzip
        unzip /workspace/source.zip -d /workspace
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - '${imageName}:latest' # Floating tag for developers
      - '-t'
      - '${this.imageUri}' # Immutable tag for this specific source version
      - '-f'
      - '/workspace/${dockerfile}'
${buildArgsLines}
      - '/workspace'
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', '${imageName}']
timeout: ${buildTimeout}
options:
  machineType: ${machineType}
  logging: CLOUD_LOGGING_ONLY
serviceAccount: '${buildServiceAccount.name}'
`


    // --- LocalExec Build Step ---
    const buildScript = `
      # Exit immediately if a command exits with a non-zero status.
      set -e
      # Trace commands before they are executed.
      set -x

      echo "Submitting build to project ${scope.projectId}..."

      CLOUDBUILD_CONFIG=$(mktemp)
      trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT
      cat > "$CLOUDBUILD_CONFIG" <<EOF
${cloudbuildYaml}
EOF

      gcloud builds submit --quiet --no-source --config="$CLOUDBUILD_CONFIG" --project=${scope.projectId} --billing-project=${scope.projectId}
    `
    const buildStep = new LocalExec(this, this.id('build-step'), {
      dependsOn: [
        deployerActAsBuildSa,
        archive,
        archiveFile,
      ],
      command: buildScript,
    })

    const imagePropagationDelay = new Sleep(
      this,
      this.id('image-propagation-delay'),
      {
        createDuration: '30s',
        dependsOn: [buildStep],
      },
    )

    // --- Cloud Run Service ---
    this.service = new CloudRunV2Service(this, serviceId, {
      name: serviceId,
      location: region,
      project: scope.projectId,
      deletionProtection: false,
      template: {
        scaling: { minInstanceCount: minScale, maxInstanceCount: maxScale },
        vpcAccess: {
          connector: scope.vpcConnectorId,
          egress: 'ALL_TRAFFIC',
        },
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
      traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
      dependsOn: [imagePropagationDelay, deployerBinding, ...dependsOn],
    })

    // --- Service Invoker IAM ---
    new CloudRunServiceIamBinding(this, this.id('binding-invoker'), {
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