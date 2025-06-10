import { Construct } from 'constructs'
import type { IngressStack } from '../stacks/ingress-stack.mjs'

export class BaseIngressConstruct<T> extends Construct {
  protected constructConfig: T
  protected constructId: string
  protected constructScope: IngressStack

  constructor(scope: IngressStack, id: string, config: T) {
    super(scope, id)

    this.constructScope = scope
    this.constructId = id
    this.constructConfig = config
  }

  id(...tokens: string[]) {
    return this.constructScope.id(this.constructId, ...tokens)
  }
}
