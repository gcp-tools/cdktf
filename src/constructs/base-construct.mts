import { Construct } from 'constructs'
import type { AppStack } from '../stacks/app-stack.mjs'

export type BaseConstructConfig = Record<string, unknown>

export class BaseConstruct<T extends BaseConstructConfig> extends Construct {
  protected constructConfig: T
  protected constructId: string
  protected constructScope: AppStack

  constructor(scope: AppStack, id: string, config: T) {
    super(scope, id)

    this.constructScope = scope
    this.constructId = id
    this.constructConfig = config
  }

  id(...tokens: string[]) {
    return this.constructScope.id(this.constructId, ...tokens)
  }
}