import type { App } from 'cdktf'
import { BaseStack, type BaseStackConfig } from '../base-stack.mjs'

export class BaseInfraStack<T> extends BaseStack<BaseStackConfig> {
  constructor(scope: App, id: string, infraConfig: T) {
    super(scope, id, 'infra', {
      ...infraConfig,
      user: 'ci',
    })
  }
}
