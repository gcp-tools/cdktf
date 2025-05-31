import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

export class DataProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'data', {
      apis: [
        'compute',
        'servicenetworking',
        'sqladmin',
        'secretmanager',
        ...config.apis,
      ],
    })
  }
}
