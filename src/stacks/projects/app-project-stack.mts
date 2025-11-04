/**
 * A project stack for hosting application services.
 *
 * This stack enables the common APIs for running serverless applications like
 * Cloud Run and Cloud Functions, along with supporting services like Pub/Sub,
 * Scheduler, and Firestore. It should not contain ingress resources like
 * Load Balancers, which belong in the host project.
 *
 * @example
 * ```ts
 * new AppProjectStack(app, 'my-app-project')
 * ```
 */
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { StorageBucket } from '@cdktf/provider-google/lib/storage-bucket/index.js'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

const appProjectApis = [
  'artifactregistry',
  'cloudbuild',
  'cloudfunctions',
  'cloudscheduler',
  'cloudtasks',
  'eventarc',
  'eventarcpublishing',
  'iam',
  'logging',
  'pubsub',
  'run',
  'secretmanager',
  'storage',
]

export class AppProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    const mergedApis = [...appProjectApis, ...config.apis]

    super(scope, 'app', {
      apis: mergedApis,
    })

    for (const region of envConfig.regions) {
      new StorageBucket(this, `gcf-sources-bucket-${region}`, {
        name: `gcf-v2-sources-${this.project.number}-${region}`,
        project: this.project.projectId,
        location: region,
        uniformBucketLevelAccess: true,
      })
    }

    new ProjectIamMember(this, this.id('iam', 'deployer', 'editor'), {
      project: this.projectId,
      role: 'roles/serviceusage.serviceUsageAdmin',
      member: `serviceAccount:${envConfig.deployerSaEmail}`,
    })

    new ProjectIamMember(this, this.id('iam', 'deployer', 'builder'), {
      project: this.projectId,
      role: 'roles/cloudbuild.builds.builder',
      member: `serviceAccount:${envConfig.deployerSaEmail}`,
    })

    new ProjectIamMember(
      this,
      this.id('iam', 'deployer', 'artifact', 'registry', 'writer'),
      {
        project: this.projectId,
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )

    new ProjectIamMember(
      this,
      this.id('iam', 'deployer', 'identitytoolkit', 'admin'),
      {
        project: this.projectId,
        role: 'roles/identitytoolkit.admin',
        member: `serviceAccount:${envConfig.deployerSaEmail}`,
      },
    )
  }
}
