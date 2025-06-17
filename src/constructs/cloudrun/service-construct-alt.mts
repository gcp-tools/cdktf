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
import { ServiceAccountIamBinding } from '@cdktf/provider-google/lib/service-account-iam-binding/index.js'
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

    // --- IAM Permissions ---
    // The deployer's editor permission is now managed by the AppStack.
    // This construct will depend on it via scope.deployerEditorBinding.

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
        'source.zip',
      ),
    })
    const archive = new StorageBucketObject(this, this.id('archive'), {
      bucket: bucket.name,
      name: archiveFile.outputMd5,
      source: archiveFile.outputPath,
    })

    // Grant the Cloud Build service account permission to write to the repo.
    // This depends on the deployer having permissions to view/edit IAM policies.
    const cloudBuildServiceAccountBinding = new ProjectIamMember(
      this,
      this.id('cloudbuild-registry-writer'),
      {
        project: scope.projectId,
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        dependsOn: [repository],
      },
    )

    new StorageBucketIamBinding(this, this.id('cloudbuild-bucket-reader'), {
      bucket: bucket.name,
      members: [
        `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        `serviceAccount:${scope.projectNumber}-compute@developer.gserviceaccount.com`
      ],
      role: 'roles/storage.objectViewer',
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

    // Wait for the roles/editor (owner) binding on the deployer SA to propagate
    const iamPropagationDelay = new Sleep(
      this,
      this.id('iam-propagation-delay'),
      {
        createDuration: '60s',
        dependsOn: [cloudBuildServiceAccountBinding],
      },
    )

    // --- Image URI & Build YAML ---
    this.imageUri = `${region}-docker.pkg.dev/${scope.projectId}/${repository.name}/${serviceId}:latest`
    const imageUriWithBuildId = this.imageUri.replace(':latest', ':\\$BUILD_ID') // Escape for shell
    const buildArgsLines = Object.entries(buildArgs)
      .map(([key, value]) => `      - '--build-arg=${key}=${value}'`)
      .join('\n')
    const cloudbuildYaml = `
steps:
  - name: 'gcr.io/cloud-builders/gsutil'
    args: ['cp', 'gs://${bucket.name}/${archive.name}', '/workspace/source.zip']
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
      - '/workspace/src/${dockerfile}'
${buildArgsLines}
      - '/workspace/src'
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${this.imageUri}']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${imageUriWithBuildId}']
timeout: ${buildTimeout}
options:
  machineType: ${machineType}
  logging: CLOUD_LOGGING_ONLY
  substitution_option: ALLOW_LOOSE
`

    // --- LocalExec Build Step ---
    const buildStep = new LocalExec(this, this.id('build-step'), {
      dependsOn: [
        iamPropagationDelay,
        archive,
        cloudBuildServiceAccountBinding,
      ],
      command: `
        # Exit immediately if a command exits with a non-zero status.
        set -e
        # Trace commands before they are executed.
        set -x

        # Show which credential file is being used and its base64-encoded contents (diagnostic)
        CRED_FILE=$(gcloud config get-value auth/credential_file_override 2>/dev/null)
        echo "gcloud credential file: $CRED_FILE"
        if [ -f "$CRED_FILE" ]; then
          # Encode without line-wrap (-w 0 is GNU base64; macOS ignores it)
          CREDS_B64=$(base64 -w 0 "$CRED_FILE" 2>/dev/null || base64 "$CRED_FILE")
          echo "gcloud credential (b64): $CREDS_B64"
        else
          echo "credential file not found; unable to display contents"
        fi

        # The gcloud command will use the ambient authentication from the
        # environment (e.g., from Workload Identity Federation in CI/CD).
        echo "Ensuring Cloud Build API is enabled for project ${scope.projectId}..."
        gcloud services enable --quiet cloudbuild.googleapis.com --project=${scope.projectId}

        # Wait until the Cloud Build API is fully enabled (max ~2 minutes)
        for i in {1..24}; do
          if gcloud services list --enabled --project=${scope.projectId} \
            --filter="cloudbuild.googleapis.com" --format="value(config.name)" | grep -q .; then
            echo "Cloud Build API is enabled."
            break
          fi
          echo "Waiting for Cloud Build API enablement to propagate..."
          sleep 5
        done

        echo "Submitting build to project ${scope.projectId}..."

        CLOUDBUILD_CONFIG=$(mktemp)
        trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT

        cat > "$CLOUDBUILD_CONFIG" <<EOF
${cloudbuildYaml}
EOF
        gcloud builds submit --quiet --no-source --config="$CLOUDBUILD_CONFIG" --project=${scope.projectId}
      `,
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
              initialDelaySeconds: 0,
              timeoutSeconds: 1,
              periodSeconds: 3,
              failureThreshold: 1,
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
