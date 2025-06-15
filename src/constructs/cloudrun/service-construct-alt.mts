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
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
import type { ITerraformDependable } from 'cdktf'
import { LocalExec } from 'cdktf-local-exec'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { envConfig } from '../../utils/env.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'
import { ProjectService } from '@cdktf/provider-google/lib/project-service/index.js'

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

    // --- API Enablement ---
    const cloudBuildApi = new ProjectService(this, this.id('cloudbuild-api'), {
      project: scope.projectId,
      service: 'cloudbuild.googleapis.com',
      disableOnDestroy: false, // Keep API enabled
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

    // --- IAM Permissions ---
    const iamBindingForDeployerBuilds = new ProjectIamMember(
      this,
      this.id('deployer-cloudbuild-builder'),
      {
        project: scope.projectId,
        role: 'roles/cloudbuild.builds.builder',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )
    const serviceUsageAdminBinding = new ProjectIamMember(
      this,
      this.id('service-usage-admin'),
      {
        project: scope.projectId,
        role: 'roles/serviceusage.serviceUsageAdmin',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )
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
`

    // --- LocalExec Build Step ---
    const buildStep = new LocalExec(this, this.id('build-step'), {
      dependsOn: [
        archive,
        cloudBuildServiceAccountBinding,
        iamBindingForDeployerBuilds,
        serviceUsageAdminBinding,
        cloudBuildApi,
      ],
      command: `
        # Exit immediately if a command exits with a non-zero status.
        set -e
        # Trace commands before they are executed.
        set -x

        # Ensure we're using the right credentials
        if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
          echo "ERROR: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set"
          exit 1
        fi

        echo "Using credentials file: $GOOGLE_APPLICATION_CREDENTIALS"

        # Create a temporary directory for credentials
        CREDS_DIR=$(mktemp -d)
        trap 'rm -rf "$CREDS_DIR"' EXIT

        # Check if the credentials are Base64 encoded
        if head -n1 "$GOOGLE_APPLICATION_CREDENTIALS" | grep -q '^eyJ'; then
          echo "Credentials appear to be Base64 encoded, decoding..."
          base64 -d "$GOOGLE_APPLICATION_CREDENTIALS" > "$CREDS_DIR/decoded_creds.json"
          export GOOGLE_APPLICATION_CREDENTIALS="$CREDS_DIR/decoded_creds.json"
        else
          echo "Credentials appear to be in JSON format, validating..."
          if ! jq empty "$GOOGLE_APPLICATION_CREDENTIALS" 2>/dev/null; then
            echo "ERROR: Credentials file is not valid JSON"
            exit 1
          fi
        fi

        echo "Validating service account key format..."
        if ! jq -e '.type == "service_account"' "$GOOGLE_APPLICATION_CREDENTIALS" >/dev/null; then
          echo "ERROR: Credentials file is not a service account key"
          echo "Content type: $(jq -r '.type' "$GOOGLE_APPLICATION_CREDENTIALS")"
          exit 1
        fi

        echo "Activating service account: $(jq -r '.client_email' "$GOOGLE_APPLICATION_CREDENTIALS")"
        gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"

        echo "=== DETAILED DIAGNOSTICS ==="

        echo "1. Project Information:"
        echo "Current Project ID: $(gcloud config get-value project)"
        echo "Target Project ID: ${scope.projectId}"
        echo "Project Number: ${scope.projectNumber}"

        echo "2. Service Account Information:"
        echo "Current Service Account: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"

        echo "3. Cloud Build API Status:"
        if gcloud services list --enabled --filter="name:cloudbuild.googleapis.com" --project=${scope.projectId}; then
          echo "Cloud Build API is enabled"
        else
          echo "Cloud Build API is NOT enabled"
          exit 1
        fi

        # Configure gsutil to use same credentials
        echo "Configuring gsutil authentication..."
        export BOTO_CONFIG=/dev/null
        gcloud auth configure-docker ${region}-docker.pkg.dev --quiet

        echo "4. Storage Bucket Access Test:"
        echo "Testing access to: gs://${bucket.name}/${archive.name}"
        if gsutil ls gs://${bucket.name}/${archive.name}; then
          echo "Storage access successful"
        else
          echo "Storage access failed"
          echo "Checking bucket IAM policy:"
          gsutil iam get gs://${bucket.name}
          exit 1
        fi

        echo "5. Cloud Build Service Account:"
        echo "Expected Cloud Build SA: ${scope.projectNumber}@cloudbuild.gserviceaccount.com"
        echo "Expected Compute SA: ${scope.projectNumber}-compute@developer.gserviceaccount.com"

        echo "=== END DIAGNOSTICS ==="

        CLOUDBUILD_CONFIG=$(mktemp)
        trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT

        echo "Writing build config..."
        cat > "$CLOUDBUILD_CONFIG" <<EOF
${cloudbuildYaml}
EOF

        echo "Submitting build..."
        gcloud builds submit --no-source --config="$CLOUDBUILD_CONFIG" --project=${scope.projectId}
      `,
    })

    // --- Image Propagation Delay ---
    const imagePropagationDelay = new LocalExec(
      this,
      this.id('image-propagation-delay'),
      {
        dependsOn: [buildStep],
        command: `
          for i in {1..5}; do
            if gcloud container images describe ${this.imageUri} --project=${scope.projectId} >/dev/null 2>&1; then
              echo "Image found after $i attempts."
              exit 0
            fi
            echo "Image not yet found. Waiting 15 seconds..."
            sleep 15
          done
          echo "Image not found after 5 attempts."
          exit 1
        `,
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
