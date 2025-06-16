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
import { ProjectIamBinding } from '@cdktf/provider-google/lib/project-iam-binding/index.js'
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
    // Create a dependency chain to avoid race conditions.
    const serviceUsageAdminBinding = new ProjectIamMember(
      this,
      this.id('service-usage-admin'),
      {
        project: scope.projectId,
        role: 'roles/serviceusage.serviceUsageAdmin',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )

    const cloudBuildViewerBinding = new ProjectIamBinding(
      this,
      this.id('deployer-cloudbuild-viewer'),
      {
        project: scope.projectId,
        role: 'roles/cloudbuild.builds.viewer',
        members: [`serviceAccount:${envConfig.deployerSaEmail}`],
        dependsOn: [serviceUsageAdminBinding],
      },
    )

    const iamBindingForDeployerBuilds = new ProjectIamMember(
      this,
      this.id('deployer-cloudbuild-builder'),
      {
        project: scope.projectId,
        role: 'roles/cloudbuild.builds.builder',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
        dependsOn: [cloudBuildViewerBinding],
      },
    )

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

    const cloudBuildServiceAccountBinding = new ProjectIamMember(
      this,
      this.id('cloudbuild-registry-writer'),
      {
        project: scope.projectId,
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${scope.projectNumber}@cloudbuild.gserviceaccount.com`,
        dependsOn: [repository, iamBindingForDeployerBuilds],
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
        cloudBuildViewerBinding,
      ],
      command: `
        # Exit immediately if a command exits with a non-zero status.
        set -e
        # Trace commands before they are executed.
        set -x

        # Clear any existing project override
        unset CLOUDSDK_CORE_PROJECT

        # Get the WIF token from GitHub Actions
        if [ -z "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" ] || [ -z "$ACTIONS_ID_TOKEN_REQUEST_URL" ]; then
          echo "ERROR: GitHub Actions WIF token not available"
          exit 1
        fi

        echo "Using GitHub Actions WIF token"

        # Get the token
        TOKEN=$(curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL" | jq -r '.value')
        if [ -z "$TOKEN" ]; then
          echo "ERROR: Failed to get WIF token"
          exit 1
        fi

        # Create temporary credential file
        CRED_FILE=$(mktemp)
        trap 'rm -f "$CRED_FILE"' EXIT

        # Write the credential configuration
        echo '{
          "type": "external_account",
          "audience": "//iam.googleapis.com/projects/799601195209/locations/global/workloadIdentityPools/liplan-dev-pool/providers/github-actions-provider",
          "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
          "token_url": "https://sts.googleapis.com/v1/token",
          "credential_source": {
            "url": "https://token.actions.githubusercontent.com",
            "headers": {
              "Authorization": "Bearer '"$TOKEN"'"
            },
            "format": {
              "type": "json",
              "subject_token_field_name": "value"
            }
          },
          "service_account_impersonation_url": "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/liplan-sa@liplan-foundation-1749487766.iam.gserviceaccount.com:generateAccessToken"
        }' > "$CRED_FILE"

        # Authenticate with GCP using the token
        echo "Authenticating with GCP..."
        gcloud auth login --brief --cred-file="$CRED_FILE" --quiet

        # Ensure we're using the right project
        echo "Setting project to: ${scope.projectId}"
        gcloud config set project ${scope.projectId}

        # Verify project setting
        CURRENT_PROJECT=$(gcloud config get-value project)
        if [ "$CURRENT_PROJECT" != "${scope.projectId}" ]; then
          echo "ERROR: Failed to set project. Current: $CURRENT_PROJECT, Expected: ${scope.projectId}"
          exit 1
        fi

        echo "=== DETAILED DIAGNOSTICS ==="

        echo "1. Project Information:"
        echo "Current Project ID: $(gcloud config get-value project)"
        echo "Target Project ID: ${scope.projectId}"
        echo "Project Number: ${scope.projectNumber}"

        echo "2. Service Account Information:"
        echo "Current Service Account: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"

        echo "3. Cloud Build API Status:"
        echo "Checking Cloud Build API status in project ${scope.projectId}..."

        # First check if API is enabled
        if ! gcloud services list --enabled --filter="name:cloudbuild.googleapis.com" --project=${scope.projectId} --format="get(name)" | grep -q "cloudbuild.googleapis.com"; then
          echo "ERROR: Cloud Build API is not enabled"
          exit 1
        fi
        echo "Cloud Build API is enabled according to services list"

        # Double check with a direct API call, retrying to handle IAM propagation delay
        echo "Verifying API access (will retry for 60 seconds)..."

        # Create a minimal config file for API check
        API_CHECK_CONFIG=$(mktemp)
        trap 'rm -f "$API_CHECK_CONFIG"' EXIT
        echo 'steps: []' > "$API_CHECK_CONFIG"

        i=1
        while [ $i -le 6 ]; do
          if gcloud builds submit --no-source --config="$API_CHECK_CONFIG" --project=${scope.projectId} >/dev/null 2>&1; then
            echo "Successfully accessed Cloud Build API after $i attempts."
            break
          fi
          if [ $i -eq 6 ]; then
            echo "ERROR: Could not access Cloud Build API after 60 seconds."
            exit 1
          fi
          echo "API access check failed. Waiting 10 seconds before retry ($i/6)..."
          sleep 10
          i=$((i + 1))
        done

        # Configure gsutil to use same credentials
        echo "Configuring gsutil authentication..."
        export BOTO_CONFIG=/dev/null

        echo "4. Storage Bucket Access Test:"
        echo "Testing access to: gs://${bucket.name}/${archive.name}"
        if gsutil ls gs://${bucket.name}/${archive.name}; then
          echo "Storage access successful"
        else
          echo "Storage access failed"
          echo "Checking bucket IAM policy:"
          gsutil iam get gs://${bucket.name} || echo "Failed to get bucket IAM policy"
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
        echo "Using project: ${scope.projectId}"
        echo "Current account: $(gcloud config get-value account)"

        # Try the build submission with retries
        MAX_RETRIES=3
        for i in $(seq 1 $MAX_RETRIES); do
          echo "Attempt $i of $MAX_RETRIES..."
          if gcloud builds submit --no-source --config="$CLOUDBUILD_CONFIG" --project=${scope.projectId}; then
            echo "Build submitted successfully"
            break
          fi
          if [ $i -eq $MAX_RETRIES ]; then
            echo "Failed all $MAX_RETRIES attempts"
            exit 1
          fi
          echo "Waiting before retry..."
          sleep 10
        done
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
