import type { Construct } from 'constructs'
import { ProjectStack, type ProjectStackConfig } from '../project-stack.mjs'

export class DbProjectStack extends ProjectStack {
  constructor(scope: Construct, config: ProjectStackConfig) {
    super(scope, 'db', {
      ...config,
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
