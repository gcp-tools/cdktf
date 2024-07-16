import { GoogleProvider } from '@cdktf/provider-google/lib/provider/index.js'
import { RandomProvider } from '@cdktf/provider-random/lib/provider/index.js'
import { GcsBackend, TerraformStack } from 'cdktf'
import type { Construct } from 'constructs'

export type StackType = 'project' | 'infra' | 'app'
export type BaseStackConfig = {
  bucket: string
  environment: string
  region: string
  user: string
}

export class BaseStack<T extends BaseStackConfig> extends TerraformStack {
  public stackConfig: T
  protected stackId: string
  protected stackScope: Construct
  protected stackType: StackType

  constructor(scope: Construct, id: string, stackType: StackType, config: T) {
    super(scope, id)

    this.stackType = stackType
    this.stackScope = scope
    this.stackId = id
    this.stackConfig = config

    new GoogleProvider(this, 'google-provider', {
      region: config.region,
    })

    new RandomProvider(this, 'random-provider')

    new GcsBackend(this, {
      bucket: config.bucket,
      prefix: this.identifier('/'),
    })
  }

  identifier(delimiter = '-') {
    const { environment, user } = this.stackConfig
    if (this.stackType === 'app' && user !== 'ci') {
      return `${user}${delimiter}${this.stackType}${delimiter}${this.stackId}`
    }
    return `${environment}${delimiter}${this.stackType}${delimiter}${this.stackId}`
  }

  id(...tokens: string[]) {
    return `${this.identifier()}${tokens.length ? `-${tokens.join('-')}` : ''}`
  }

  remotePrefix(stackType: string, remoteId: string) {
    const { environment } = this.stackConfig
    return [environment, stackType, remoteId].join('/')
  }

  shortName(...tokens: string[]) {
    return `${this.stackConfig.user}-${this.stackId}${tokens.length ? `-${tokens.join('-')}` : ''}`
  }
}
