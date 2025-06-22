import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../utils/env.mjs'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'

/**
 * A base stack for creating ingress resources within the host project.
 *
 * It automatically retrieves the remote state of the 'host' project,
 * providing essential properties like the project ID to the consuming stack.
 * The implementing stack is responsible for creating the actual load
 * balancer and other ingress resources.
 *
 * @example
 * ```ts
 * // In the consuming application:
 * class MyIngressStack extends IngressStack {
 *   constructor(scope: App, id: string) {
 *     super(scope, id)
 *
 *     // Now you can use this.hostProjectId to configure resources
 *     // that need to be created in the host project.
 *   }
 * }
 * ```
 */
export class IngressStack extends BaseStack<BaseStackConfig> {
  public readonly hostProjectId: string
  public readonly hostProjectNumber: string
  public readonly stackServiceAccount: ServiceAccount

  constructor(scope: App, id: string, config: BaseStackConfig) {
    super(scope, id, 'ingress', {
      ...config,
      user: envConfig.user,
    })

    const hostProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'host'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'host'),
      },
    )

    this.hostProjectId = hostProjectRemoteState.getString('project-id')
    this.hostProjectNumber = hostProjectRemoteState.getString('project-number')

    const serviceAccountId = this.id('sa', 'ingress')
    this.stackServiceAccount = new ServiceAccount(this, serviceAccountId, {
      accountId: serviceAccountId,
      project: this.hostProjectId,
      description: 'Service account for ingress resources',
    })
  }
}
