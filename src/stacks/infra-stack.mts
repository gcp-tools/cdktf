import type { Construct } from 'constructs'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'

export type InfraStackConfig = Omit<BaseStackConfig, 'user'> & {}

export class InfraStack extends BaseStack<BaseStackConfig> {
  constructor(scope: Construct, id: string, config: InfraStackConfig) {
    super(scope, id, 'infra', {
      ...config,
      user: 'ci'
    })
  }
}
