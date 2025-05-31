import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

export class AppProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'app', {
      apis: [
        'artifactregistry',
        'cloudbilling',
        'cloudbuild',
        'cloudfunctions',
        'cloudresourcemanager',
        'cloudscheduler',
        'cloudtasks',
        'compute',
        'eventarc',
        'eventarcpublishing',
        'firestore',
        'iam',
        'iamcredentials',
        'logging',
        'networkconnectivity',
        'networkmanagement',
        'pubsub',
        'run',
        'dns',
        'secretmanager',
        'servicenetworking',
        'serviceusage',
        'sql-component',
        'sqladmin',
        'storage',
        'storage-component',
        'vpcaccess',
        ...config.apis,
      ],
    })
  }
}
