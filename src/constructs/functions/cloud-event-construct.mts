// import { dirname, relative, resolve } from 'node:path'
// import { cwd } from 'node:process'
// import { fileURLToPath } from 'node:url'
// import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file/index.js'
// import { CloudRunServiceIamBinding } from '@cdktf/provider-google/lib/cloud-run-service-iam-binding/index.js'
// import { Cloudfunctions2Function } from '@cdktf/provider-google/lib/cloudfunctions2-function/index.js'
// import type {
//   Cloudfunctions2FunctionBuildConfig,
//   Cloudfunctions2FunctionEventTrigger,
//   Cloudfunctions2FunctionServiceConfig,
// } from '@cdktf/provider-google/lib/cloudfunctions2-function/index.js'
// import type { DataGoogleVpcAccessConnector } from '@cdktf/provider-google/lib/data-google-vpc-access-connector/index.js'
// import type { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
// import { StorageBucketObject } from '@cdktf/provider-google/lib/storage-bucket-object/index.js'
// import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
// import type { ITerraformDependable } from 'cdktf'
// import type { AppStack } from '../../stacks/app-stack.mjs'
// import { envConfig } from '../../utils/env.mjs'
// import { BaseConstruct } from '../base-construct.mjs'
// const sourceDirectory = resolve(
//   relative(cwd(), dirname(fileURLToPath(import.meta.url))),
//   '..',
//   'deploy',
// )

// export type CloudEventConstructConfig = {
//   buildConfig: Partial<Cloudfunctions2FunctionBuildConfig>
//   dependsOn?: ITerraformDependable[]
//   eventTrigger: Cloudfunctions2FunctionEventTrigger
//   grantInvokerPermissions?: string[]
//   serviceConfig: Partial<Cloudfunctions2FunctionServiceConfig>
//   vpcConnector: DataGoogleVpcAccessConnector //  get from AppStack
// }

// export class CloudFunctionConstruct<
//   T extends CloudEventConstructConfig,
// > extends BaseConstruct<CloudEventConstructConfig> {
//   protected archive!: StorageBucketObject
//   protected archiveFile!: DataArchiveFile
//   protected bucket!: StorageBucket
//   protected bucketIAMBinding!: StorageBucketIamBinding
//   protected invoker: CloudRunServiceIamBinding
//   public fn: Cloudfunctions2Function

//   constructor(scope: AppStack, id: string, config: T) {
//     super(scope, id, config)

//     const sourceDir = resolve(sourceDirectory, id)

//     this.bucket = new StorageBucket(this, this.id('source', 'code'), {
//       dependsOn: [scope.stackServiceAccount, ...(config.dependsOn || [])],
//       forceDestroy: true,
//       location: envConfig.region,
//       name: this.constructId,
//       project: scope.projectId,
//       versioning: {
//         enabled: true,
//       },
//     })

//     const outputPath = resolve(
//       '.',
//       'cdktf.out',
//       'stacks',
//       `${scope.projectId}`,
//       'assets',
//       `${this.constructId}.zip`,
//     )

//     this.archiveFile = new DataArchiveFile(this, this.id('archive', 'file'), {
//       outputPath,
//       sourceDir,
//       type: 'zip',
//     })

//     this.archive = new StorageBucketObject(this, this.id('archive'), {
//       bucket: this.bucket.name,
//       dependsOn: [this.bucket],
//       name: this.archiveFile.outputMd5,
//       source: this.archiveFile.outputPath,
//     })

//     const fnId = this.id('fn')
//     this.fn = new Cloudfunctions2Function(this, fnId, {
//       buildConfig: {
//         dockerRepository: `projects/${this.constructScope.projectName}/locations/${envConfig.region}/repositories/gcf-artifacts`,
//         runtime: 'nodejs20',
//         entryPoint: 'main',
//         ...config.buildConfig,
//         source: {
//           storageSource: {
//             bucket: this.bucket.name,
//             object: this.archive.name,
//           },
//         },
//       },
//       dependsOn: [this.archive],
//       eventTrigger: {
//         eventType: 'google.cloud.pubsub.topic.v1.messagePublished',
//         ...config.eventTrigger,
//       },
//       location: envConfig.region,
//       name: fnId,
//       project: this.constructScope.projectId,
//       serviceConfig: {
//         allTrafficOnLatestRevision: true,
//         availableMemory: '256M',
//         environmentVariables: {},
//         ingressSettings: 'ALLOW_ALL',
//         maxInstanceRequestConcurrency: 1,
//         minInstanceCount: 1,
//         serviceAccountEmail: this.constructScope.stackServiceAccount.email,
//         timeoutSeconds: 60,
//         ...config.serviceConfig,
//         ...(config.serviceConfig.availableCpu
//           ? { availableCpu: config.serviceConfig.availableCpu }
//           : {}),
//         vpcConnector: config.vpcConnector.id,
//         vpcConnectorEgressSettings: 'PRIVATE_RANGES_ONLY',
//       },
//       timeouts: {
//         create: '5m',
//         delete: '5m',
//         update: '5m',
//       },
//     })

//     this.invoker = new CloudRunServiceIamBinding(
//       this,
//       this.id('binding', 'invoker'),
//       {
//         dependsOn: [this.fn],
//         location: envConfig.region,
//         members: [
//           `serviceAccount:${scope.stackServiceAccount.email}`,
//           `serviceAccount:service-${scope.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`, // ?
//           ...(config.grantInvokerPermissions || []),
//         ],
//         project: scope.projectId,
//         role: 'roles/run.invoker',
//         service: this.fn.name,
//       },
//     )
//   }
// }
