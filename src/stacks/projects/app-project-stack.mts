import type { Construct } from 'constructs'
import { ProjectStack, type ProjectStackConfig } from '../project-stack.mjs'

export class AppProjectStack extends ProjectStack {
  constructor(scope: Construct, config: ProjectStackConfig) {
    super(scope, 'app', {
      ...config,
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
