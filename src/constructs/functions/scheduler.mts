// import { CloudSchedulerJob } from '@cdktf/provider-google/lib/cloud-scheduler-job/index.js'
// import type { Construct } from 'constructs'

// import {
//   CloudFunction2HTTPTrigger,
//   type CloudFunction2HTTPTriggerConfig,
// } from './http-trigger.mjs'

// export type CloudFunction2SchedulerConfig = CloudFunction2HTTPTriggerConfig & {
//   paused?: boolean
//   schedule: string
// }

// export class CloudFunction2Scheduler extends CloudFunction2HTTPTrigger {
//   protected declare readonly config: CloudFunction2SchedulerConfig

//   protected scheduler!: CloudSchedulerJob

//   public static new(
//     scope: Construct,
//     id: string,
//     config: CloudFunction2SchedulerConfig,
//   ) {
//     return new CloudFunction2Scheduler(scope, id, config)
//   }

//   constructor(
//     scope: Construct,
//     id: string,
//     config: CloudFunction2SchedulerConfig,
//   ) {
//     super(scope, id, config)

//     this.initSchedule()
//   }

//   initSchedule() {
//     const {
//       paused = true,
//       serviceConfig: {
//         environmentVariables: { NODE_ENV = 'dev' } = {},
//         timeoutSeconds = 60,
//       },
//       schedule,
//       serviceAccount: { serviceAccount },
//     } = this.config

//     this.scheduler = new CloudSchedulerJob(
//       this,
//       `${this.id}-scheduler-${NODE_ENV}`,
//       {
//         attemptDeadline: `${timeoutSeconds}s`,
//         dependsOn: [this.lambda],
//         httpTarget: {
//           httpMethod: 'GET',
//           oidcToken: {
//             serviceAccountEmail: serviceAccount.email,
//           },
//           uri: this.lambda.serviceConfig.uri,
//         },
//         name: `${this.id}-scheduler-${NODE_ENV}`,
//         paused,
//         schedule,
//       },
//     )
//   }
// }
