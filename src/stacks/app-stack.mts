import { ArchiveProvider } from '@cdktf/provider-archive/lib/provider/index.js'
import { SqlUser } from '@cdktf/provider-google/lib/sql-user/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { SecretManagerSecret } from '@cdktf/provider-google/lib/secret-manager-secret/index.js'
// import { ServiceAccountIamMember } from '@cdktf/provider-google/lib/service-account-iam-member/index.js'
import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
import { Password } from '@cdktf/provider-random/lib/password/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import { App } from 'cdktf'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'
import { envConfig } from '../utils/env.mjs'

export class AppStack extends BaseStack<BaseStackConfig> {
  protected dbInstanceId: string
  protected dbProjectId: string
  protected appRemoteState: DataTerraformRemoteStateGcs
  protected networkRemoteState: DataTerraformRemoteStateGcs
  protected sqlRemoteState: DataTerraformRemoteStateGcs

  public projectId: string
  public projectName: string
  public projectNumber: string
  public secret: SecretManagerSecret
  public stackServiceAccount: ServiceAccount
  public sqlUser: SqlUser
  public vpcConnectorId: string
  public vpcProjectId: string

  constructor(scope: App, id: string) {
    super(scope, id, 'app', {
      user: envConfig.user
    })

    new ArchiveProvider(this, 'archive-provider')

    this.appRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.networkRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'network'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infra', 'network'),
      },
    )

    this.sqlRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'sql'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infra', 'sql'),
      },
    )

    this.dbInstanceId = this.sqlRemoteState.getString('db-instance-id')
    this.dbProjectId = this.sqlRemoteState.getString('db-project-id')
    this.projectId = this.appRemoteState.getString('project-id')
    this.projectName = this.appRemoteState.getString('project-name')
    this.projectNumber = this.appRemoteState.getString('project-number')
    this.vpcConnectorId = this.networkRemoteState.getString('vpc-connector-id')
    this.vpcProjectId = this.networkRemoteState.getString('vpc-project-id')

    const serviceAccountId = this.id()
    this.stackServiceAccount = new ServiceAccount(this, serviceAccountId, {
      accountId: serviceAccountId,
      description: `A generated service account for project '${this.projectId}'`,
      project: this.projectId,
    })
    const serviceAccount = `serviceAccount:${this.stackServiceAccount.email}`

    new ProjectIamMember(
      this,
      this.id('iam', 'secretmanager', 'secret' ,'accessor'),
      {
        dependsOn: [this.stackServiceAccount],
        member: serviceAccount,
        project: this.projectId,
        role: 'roles/secretmanager.secretAccessor',
      },
    )

    new ProjectIamMember(this, this.id('iam', 'secretmanager', 'viewer'), {
      dependsOn: [this.stackServiceAccount],
      member: serviceAccount,
      project: this.projectId,
      role: 'roles/secretmanager.viewer',
    })

    new ProjectIamMember(this, this.id('iam', 'storage', 'object', 'viewer'), {
      dependsOn: [this.stackServiceAccount],
      member: serviceAccount,
      project: this.projectId,
      role: 'roles/storage.objectViewer',
    })

    new ProjectIamMember(this, this.id('iam', 'logging', 'log', 'writer'), {
      dependsOn: [this.stackServiceAccount],
      member: serviceAccount,
      project: this.projectId,
      role: 'roles/logging.logWriter',
    })

    new ProjectIamMember(this, this.id('iam', 'binding', 'vpcaccess', 'admin'), {
      member: serviceAccount,
      project: this.projectId,
      role: 'roles/vpcaccess.admin',
    });

    // //  this might need to move to the project app so CI/CD can federate using it
    // new ServiceAccountIamMember(this, this.id('iam', 'workload', 'identity'), {
    //   dependsOn: [this.stackServiceAccount],
    //   member: serviceAccount,
    //   role: 'roles/iam.workloadIdentityUser',
    //   serviceAccountId: `projects/${this.projectId}/serviceAccounts/${this.stackServiceAccount.email}`,
    // })

    // this.stackServiceAccount.email.replace('.gserviceaccount.com', '') didn't work.
    // It's the same as this: `${this.id()}@${this.projectId}.iam`

    new SqlUser(this, this.id('iam', 'service', 'account', 'user'), {
      dependsOn: [
        this.stackServiceAccount
      ],
      instance: this.dbInstanceId,
      name: `${this.id()}@${this.projectId}.iam`,
      project: this.dbProjectId,
      type: "CLOUD_IAM_SERVICE_ACCOUNT"
    })

    new ProjectIamMember(this, this.id('iam', 'service', 'account', 'user', 'sql'), {
      dependsOn: [this.stackServiceAccount],
      member: serviceAccount,
      project: this.projectId,
      role: 'roles/cloudsql.client',
    })

    const sqlId = this.id('sql', 'user')
    this.sqlUser = new SqlUser(this, sqlId, {
      instance: this.dbInstanceId,
      name: sqlId,
      project: this.dbProjectId,
      password: new Password(this, this.id('sql', 'user', 'password'), {
        length: 16,
        special: false,
      }).result
    })

    const secretId = this.id('secret', 'sql', 'password')
    this.secret = new SecretManagerSecret(this, secretId, {
      project: this.projectId,
      replication: {auto: {}},
      secretId,
    })

  }
}
