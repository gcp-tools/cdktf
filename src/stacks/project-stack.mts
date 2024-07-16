import { ProjectIamBinding } from '@cdktf/provider-google/lib/project-iam-binding/index.js'
import { ProjectService } from '@cdktf/provider-google/lib/project-service/index.js'
import { Project } from '@cdktf/provider-google/lib/project/index.js'
import { StringResource } from '@cdktf/provider-random/lib/string-resource/index.js'
import { TerraformOutput } from 'cdktf'
import type { Construct } from 'constructs'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'

export type ProjectStackConfig = Omit<BaseStackConfig, 'user'> & {
  apis: string[]
  billingAccount: string
  orgId: string
  owners: string[]
}

export class ProjectStack extends BaseStack<BaseStackConfig> {
  protected project: Project
  protected projectId: string
  protected projectName: string

  constructor(scope: Construct, id: string, config: ProjectStackConfig) {
    super(scope, id, 'project', {
      ...config,
      user: 'ci'
    })

    this.projectName = this.identifier()
    this.projectId = `${this.projectName}-${
      new StringResource(this, this.id('random', 'id'), {
        length: 6,
        lower: true,
        upper: false,
        numeric: true,
        special: false,
      }).id
    }`

    this.project = new Project(this, this.projectName, {
      autoCreateNetwork: false,
      billingAccount: config.billingAccount,
      name: this.projectName,
      orgId: config.orgId,
      projectId: this.projectId,
      skipDelete: true,
    })

    new ProjectIamBinding(this, this.id('iam', 'binding', 'owners'), {
      dependsOn: [this.project],
      members: config.owners.map((owner) => `user:${owner}`),
      project: this.projectId,
      role: 'roles/owner',
    })

    for (const api of config.apis) {
      new ProjectService(this, this.id('service', api), {
        dependsOn: [this.project],
        disableDependentServices: true,
        disableOnDestroy: false,
        project: this.project.projectId,
        service: `${api}.googleapis.com`,
      })
    }

    new TerraformOutput(this, 'project-id', {
      value: this.projectId,
    })

    new TerraformOutput(this, 'project-name', {
      value: this.project.name,
    })

    new TerraformOutput(this, 'project-number', {
      value: this.project.number,
    })
  }
}
