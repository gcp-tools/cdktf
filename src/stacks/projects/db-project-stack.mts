import { App } from 'cdktf'
import { ProjectStack, type ProjectStackConfig } from '../project-stack.mjs'

export class DbProjectStack extends ProjectStack {
  constructor(scope: App, config: ProjectStackConfig = {apis: []}) {
    super(scope, 'db', {
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
