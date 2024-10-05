import type { Construct } from 'constructs'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'


export class InfraStack<T> extends BaseStack<BaseStackConfig> {
  constructor(scope: Construct, id: string, infraConfig: T) {
    super(scope, id, 'infra', {
      ...infraConfig,
      user: 'ci'
    })
  }
}
