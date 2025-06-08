// import { ProjectIamBinding } from '@cdktf/provider-google/lib/project-iam-binding/index.js'
// import { ProjectService } from '@cdktf/provider-google/lib/project-service/index.js'
import { Project } from '@cdktf/provider-google/lib/project/index.js'
// import { ServiceAccountIamBinding } from '@cdktf/provider-google/lib/service-account-iam-binding/index.js'
// import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
// import { StringResource } from '@cdktf/provider-random/lib/string-resource/index.js'
// import { TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import { BaseStack, type BaseStackConfig } from '../base-stack.mjs'

export type ProjectStackConfig = {
  apis: string[]
}

export class BaseProjectStack extends BaseStack<BaseStackConfig> {
  protected project!: Project
  protected projectId!: string
  protected projectName!: string

  constructor(scope: App, id: string, projectConfig: ProjectStackConfig) {
    super(scope, id, 'project', {
      ...projectConfig,
      user: 'ci',
    })

    // this.projectName = this.identifier()
    // this.projectId = `${this.projectName}-${
    //   new StringResource(this, this.id('random', 'id'), {
    //     length: 6,
    //     lower: true,
    //     upper: false,
    //     numeric: true,
    //     special: false,
    //   }).id
    // }`

    // this.project = new Project(this, this.projectName, {
    //   autoCreateNetwork: false,
    //   billingAccount: envConfig.billingAccount,
    //   name: this.projectName,
    //   orgId: envConfig.orgId,
    //   projectId: this.projectId,
    //   lifecycle: {
    //     preventDestroy: false,
    //   },
    // })

    // const workloadServiceAccount = new ServiceAccount(
    //   this,
    //   this.id('sa', 'workload'),
    //   {
    //     dependsOn: [this.project],
    //     accountId: 'workload-sa',
    //     project: this.project.projectId,
    //     displayName: 'Workload Service Account',
    //   },
    // )

    // const githubPrincipalAttribute = envConfig.githubIdentitySpecifier.includes(
    //   '/',
    // )
    //   ? `attribute.repository/${envConfig.githubIdentitySpecifier}`
    //   : `attribute.repository_owner/${envConfig.githubIdentitySpecifier}`

    // const developerPrincipalAttribute =
    //   envConfig.developerIdentitySpecifier.includes('@')
    //     ? `attribute.email/${envConfig.developerIdentitySpecifier}`
    //     : 'attribute.is_developer/true'

    // const members = envConfig.ciEnvironments.map(
    //   (env) =>
    //     `principalSet://iam.googleapis.com/projects/${envConfig.foundationProjectNumber}/locations/global/workloadIdentityPools/${envConfig.foundationProjectId}-${env}-pool/${githubPrincipalAttribute}`,
    // )
    // members.push(
    //   `principalSet://iam.googleapis.com/projects/${envConfig.foundationProjectNumber}/locations/global/workloadIdentityPools/${envConfig.foundationProjectId}-dev-pool/${developerPrincipalAttribute}`,
    // )

    // new ServiceAccountIamBinding(
    //   this,
    //   this.id('iam', 'binding', 'workload-sa-wif'),
    //   {
    //     dependsOn: [workloadServiceAccount],
    //     members,
    //     role: 'roles/iam.workloadIdentityUser',
    //     serviceAccountId: workloadServiceAccount.name,
    //   },
    // )

    // new ProjectIamBinding(this, this.id('iam', 'binding', 'owners'), {
    //   dependsOn: [this.project],
    //   members: envConfig.owners.map((owner) => `user:${owner}`),
    //   project: this.project.projectId,
    //   role: 'roles/owner',
    // })

    // for (const api of projectConfig.apis) {
    //   new ProjectService(this, this.id('service', api), {
    //     dependsOn: [this.project],
    //     disableDependentServices: true,
    //     disableOnDestroy: false,
    //     project: this.project.projectId,
    //     service: `${api}.googleapis.com`,
    //   })
    // }

    // new TerraformOutput(this, 'project-id', {
    //   value: this.projectId,
    // })

    // new TerraformOutput(this, 'project-name', {
    //   value: this.project.name,
    // })

    // new TerraformOutput(this, 'project-number', {
    //   value: this.project.number,
    // })
  }

  identifier() {
    const { environment } = envConfig
    return `${envConfig.projectId}-${environment}-${this.stackId}`
  }
}
