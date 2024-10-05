import { App } from 'cdktf'
import { ProjectStack, type ProjectStackConfig } from '../project-stack.mjs'

export class HostProjectStack extends ProjectStack {
  constructor(scope: App, config: ProjectStackConfig = {apis: []}) {
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
