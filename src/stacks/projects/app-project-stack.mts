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

import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

const appProjectApis = [
  'artifactregistry',
  'cloudfunctions',
  'cloudscheduler',
  'cloudtasks',
  'compute',
  'eventarc',
  'eventarcpublishing',
  'firestore',
  'logging',
  'pubsub',
  'run',
  'secretmanager',
  'storage',
]

export class AppProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'app', {
      apis: [...appProjectApis, ...config.apis],
    })
  }
}
