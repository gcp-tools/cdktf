import type { Construct } from 'constructs'
import { ProjectStack, type ProjectStackConfig } from '../project-stack.mjs'

export class HostProjectStack extends ProjectStack {
  constructor(scope: Construct, config: ProjectStackConfig) {
    super(scope, 'host', {
      ...config,
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
