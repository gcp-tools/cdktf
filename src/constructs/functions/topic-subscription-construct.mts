import { PubsubSubscription } from '@cdktf/provider-google/lib/pubsub-subscription/index.js'
import type { AppStack } from '../../stacks/app-stack.mjs'
import type { Topic } from '../topic-construct.mjs'
import { HttpConstruct, type HttpConstructConfig } from './http-construct.mjs'

export type TopicSubscriptionFunctionConstructConfig = HttpConstructConfig & {
  ackDeadlineSeconds?: number
  filter: string
  topic: Topic
}

export class TopicSubscriptionFunctionConstruct extends HttpConstruct<TopicSubscriptionFunctionConstructConfig> {
  protected subscription: PubsubSubscription
  constructor(
    scope: AppStack<TopicSubscriptionFunctionConstructConfig>,
    id: string,
    config: TopicSubscriptionFunctionConstructConfig,
  ) {
    super(scope, id, config)

    const subscriptionId = this.id('subscription')
    this.subscription = new PubsubSubscription(this, subscriptionId, {
      ackDeadlineSeconds: config.ackDeadlineSeconds,
      deadLetterPolicy: {
        deadLetterTopic: config.topic.topicError.id,
        maxDeliveryAttempts: 7,
      },
      dependsOn: [config.topic.topic, config.topic.topicError, this.fn],
      filter: config.filter,
      name: subscriptionId,
      pushConfig: {
        oidcToken: {
          serviceAccountEmail: scope.stackServiceAccount.email,
        },
        pushEndpoint: this.fn.serviceConfig.uri,
      },
      topic: config.topic.topic.name,
    })
  }
}
