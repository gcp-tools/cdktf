import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file/index.js'
import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
import { Cloudfunctions2Function } from '@cdktf/provider-google/lib/cloudfunctions2-function/index.js'
import type {
  Cloudfunctions2FunctionBuildConfig,
  Cloudfunctions2FunctionServiceConfig,
} from '@cdktf/provider-google/lib/cloudfunctions2-function/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
import { StringResource } from '@cdktf/provider-random/lib/string-resource/index.js'
import type { ITerraformDependable } from 'cdktf'
import type { AppStack } from '../../stacks/app-stack.mjs'
import { BaseAppConstruct } from '../base-app-construct.mjs'
const sourceDirectory = resolve(cwd(), '..', 'services')

export type HttpConstructConfig = {
  buildConfig: Partial<Cloudfunctions2FunctionBuildConfig>
  dependsOn?: ITerraformDependable[]
  grantInvokerPermissions?: string[]
  serviceConfig: Partial<Cloudfunctions2FunctionServiceConfig>
  region: string
}

export class HttpConstruct<
  T extends HttpConstructConfig,
> extends BaseAppConstruct<HttpConstructConfig> {
  protected archive!: StorageBucketObject
  protected archiveFile!: DataArchiveFile
  protected bucket!: StorageBucket
  protected bucketIAMBinding!: StorageBucketIamBinding
  protected invoker: CloudRunServiceIamBinding
  public fn: Cloudfunctions2Function

  constructor(scope: AppStack, id: string, config: T) {
    super(scope, id, config)

    const sourceDir = resolve(sourceDirectory, scope.stackId, id, 'dist')

    const bucketId = `${this.id('source', 'code')}-${
      new StringResource(this, this.id('random', 'id'), {
        length: 6,
        lower: true,
        upper: false,
        numeric: true,
        special: false,
      }).id
    }`
    this.bucket = new StorageBucket(this, this.id('source', 'code'), {
      dependsOn: [scope.stackServiceAccount, ...(config.dependsOn || [])],
      forceDestroy: true,
      location: config.region,
      name: bucketId,
      project: scope.projectId,
      uniformBucketLevelAccess: true,
      versioning: {
        enabled: true,
      },
    })

    new StorageBucketIamBinding(this, this.id('iam', 'object', 'viewer'), {
      bucket: this.bucket.name,
      dependsOn: [this.bucket],
      members: [`serviceAccount:${scope.stackServiceAccount.email}`],
      role: 'roles/storage.admin',
    })

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

    const fnId = this.id('fn')
    this.fn = new Cloudfunctions2Function(this, fnId, {
      buildConfig: {
        // dockerRepository: `projects/${scope.projectId}/locations/${scope.stackConfig.region}/repositories/gcf-artifacts`,
        runtime: 'nodejs22',
        entryPoint: 'main',
        ...config.buildConfig,
        source: {
          storageSource: {
            bucket: this.bucket.name,
            object: this.archive.name,
          },
        },
      },
      dependsOn: [this.archive],
      location: config.region,
      name: fnId,
      project: scope.projectId,
      serviceConfig: {
        allTrafficOnLatestRevision: true,
        availableCpu: '1',
        availableMemory: '256M',
        environmentVariables: {},
        ingressSettings: 'ALLOW_ALL',
        maxInstanceRequestConcurrency: 40,
        minInstanceCount: 0,
        timeoutSeconds: 60,
        ...config.serviceConfig,
        ...(config.serviceConfig.availableCpu
          ? { availableCpu: config.serviceConfig.availableCpu }
          : {}),
        serviceAccountEmail: scope.stackServiceAccount.email,
        vpcConnector: scope.vpcConnectorId,
        vpcConnectorEgressSettings: 'PRIVATE_RANGES_ONLY',
      },
      timeouts: {
        create: '5m',
        delete: '5m',
        update: '5m',
      },
    })

    this.invoker = new CloudRunServiceIamBinding(
      this,
      this.id('binding', 'invoker'),
      {
        dependsOn: [this.fn],
        location: config.region,
        members: [
          `serviceAccount:${scope.stackServiceAccount.email}`,
          `serviceAccount:service-${scope.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`,
          ...(config.grantInvokerPermissions || []),
        ],
        project: scope.projectId,
        role: 'roles/run.invoker',
        service: this.fn.name,
      },
    )
  }
}
