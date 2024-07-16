import { PubsubTopicIamBinding } from '@cdktf/provider-google/lib/pubsub-topic-iam-binding/index.js'
import { PubsubTopic } from '@cdktf/provider-google/lib/pubsub-topic/index.js'
import type { ITerraformDependable } from 'cdktf'
import type { AppStack } from '../stacks/app-stack.mjs'
import { BaseConstruct } from './base-construct.mjs'

export type TopicConfig = {
  dependsOn?: ITerraformDependable[]
  members: string[]
  project: string
}

export class Topic extends BaseConstruct<TopicConfig> {
  public topic: PubsubTopic
  public topicError: PubsubTopic
  protected iamBinding: PubsubTopicIamBinding
  protected iamBindingError: PubsubTopicIamBinding

  protected constructor(scope: AppStack, id: string, config: TopicConfig) {
    super(scope, id, config)

    const topicId = this.id('topic')
    this.topic = new PubsubTopic(this, topicId, {
      dependsOn: config.dependsOn,
      name: topicId,
      project: scope.projectId,
    })

    this.iamBinding = new PubsubTopicIamBinding(this, this.id('topic', 'iam'), {
      dependsOn: [this.topic],
      members: [scope.stackServiceAccount.email],
      project: scope.projectId,
      role: 'roles/pubsub.admin',
      topic: this.topic.name,
    })

    const topicErrorId = this.id('topic', 'error')
    this.topicError = new PubsubTopic(this, topicErrorId, {
      dependsOn: config.dependsOn,
      name: topicErrorId,
      project: scope.projectId,
    })

    this.iamBindingError = new PubsubTopicIamBinding(
      this,
      this.id('topic', 'error', 'iam'),
      {
        dependsOn: [this.topicError],
        members: [`serviceAccount:${scope.stackServiceAccount.email}`],
        project: scope.projectId,
        role: 'roles/pubsub.admin',
        topic: this.topicError.name,
      },
    )
  }
}
