import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

export class HostProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'host', {
      apis: [
        'cloudbilling',
        'compute',
        'container',
        'servicenetworking',
        'secretmanager',
        'vpcaccess',
        ...config.apis,
      ],
    })
  }
}
