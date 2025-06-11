import { GoogleBetaProvider } from '@cdktf/provider-google-beta/lib/provider/index.js'
import { GoogleProvider } from '@cdktf/provider-google/lib/provider/index.js'
import { RandomProvider } from '@cdktf/provider-random/lib/provider/index.js'
import { GcsBackend, TerraformStack } from 'cdktf'
import type { Construct } from 'constructs'
import { envConfig } from '../utils/env.mjs'

export type StackType = 'project' | 'infra' | 'app' | 'ingress'
export type BaseStackConfig = {
  user: string
}

export class BaseStack<T extends BaseStackConfig> extends TerraformStack {
  public googleProvider: GoogleProvider
  public googleBetaProvider: GoogleBetaProvider

  public stackConfig: T
  public stackId: string
  protected stackScope: Construct
  protected stackType: StackType

  constructor(scope: Construct, id: string, stackType: StackType, config: T) {
    super(scope, id)

    this.stackType = stackType
    this.stackScope = scope
    this.stackId = id
    this.stackConfig = config

    this.googleProvider = new GoogleProvider(
      this,
      this.id('provider', 'google'),
      {
        // project: envConfig.projectId,
        region: envConfig.regions[0],
      },
    )

    this.googleBetaProvider = new GoogleBetaProvider(
      this,
      this.id('provider', 'google', 'beta'),
      {
        // project: this.projectId,
        region: envConfig.regions[0],
      },
    )

    new RandomProvider(this, 'random-provider')

    new GcsBackend(this, {
      bucket: envConfig.bucket,
      prefix: this.remotePrefix(this.stackType, this.stackId),
    })
  }

  identifier(delimiter = '-') {
    const { user } = this.stackConfig
    const { environment } = envConfig

    if (this.stackType === 'project') {
      return `${envConfig.projectId}${delimiter}${environment}${delimiter}${this.stackId}`
    }
    if (this.stackType === 'app' && user !== 'ci') {
      return `${envConfig.projectId}${delimiter}${user}${delimiter}${this.stackType}${delimiter}${this.stackId}`
    }
    return `${envConfig.projectId}${delimiter}${environment}${delimiter}${this.stackType}${delimiter}${this.stackId}`
  }

  remotePrefix(stackType: string, remoteId: string) {
    const { user } = this.stackConfig
    const { environment } = envConfig

    // if (stackType === 'project') {
    //   return `${envConfig.projectId}/${environment}/${remoteId}`
    // }
    if (stackType === 'app' && user !== 'ci') {
      return `${envConfig.projectId}/${user}/${stackType}/${remoteId}`
    }
    return `${envConfig.projectId}/${environment}/${stackType}/${remoteId}`
  }

  id(...tokens: string[]) {
    return `${this.identifier()}${tokens.length ? `-${tokens.join('-')}` : ''}`
  }

  shortName(...tokens: string[]) {
    return `${this.stackConfig.user}-${this.stackId}${tokens.length ? `-${tokens.join('-')}` : ''}`
  }
}
