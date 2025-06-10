import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

const hostProjectApis = [
  'apigateway',
  'certificatemanager',
  'compute',
  'dns',
  'networkservices',
  'servicenetworking',
  'vpcaccess',
]

/**
 * A project stack for hosting shared network and ingress resources.
 *
 * This stack enables the necessary APIs for creating and managing a Shared VPC,
 * Load Balancers, API Gateways, and DNS. It serves as the single entry point
 * for traffic into the environment.
 *
 * @example
 * ```ts
 * new HostProjectStack(app, 'my-host-project')
 * ```
 */
export class HostProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'host', {
      apis: [...hostProjectApis, ...config.apis],
    })
  }
}
