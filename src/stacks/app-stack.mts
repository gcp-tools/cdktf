import { ArchiveProvider } from '@cdktf/provider-archive/lib/provider/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { SecretManagerSecret } from '@cdktf/provider-google/lib/secret-manager-secret/index.js'
// import { ServiceAccountIamMember } from '@cdktf/provider-google/lib/service-account-iam-member/index.js'
import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
import { SqlUser } from '@cdktf/provider-google/lib/sql-user/index.js'
import { Password } from '@cdktf/provider-random/lib/password/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../utils/env.mjs'
import { BaseStack, type BaseStackConfig } from './base-stack.mjs'

type Database = 'alloydb' | 'bigquery' | 'cloudsql' | 'firestore' | 'spanner'

export type AppStackConfig = BaseStackConfig & {
  databases: Database[]
}

export class AppStack extends BaseStack<AppStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected networkInfraRemoteState: DataTerraformRemoteStateGcs

  public projectId: string
  public projectName: string
  public projectNumber: string
  public stackServiceAccount: ServiceAccount
  public vpcConnectorId: string
  public vpcProjectId: string

  protected firestoreDatabaseProjectId!: string
  protected firestoreDatabaseName!: string
  protected firestoreInfraRemoteState!: DataTerraformRemoteStateGcs

  protected sqlDbInstanceId!: string
  protected sqlDbProjectId!: string
  protected sqlInfraRemoteState!: DataTerraformRemoteStateGcs
  public sqlSecret!: SecretManagerSecret
  public sqlUser!: SqlUser

  constructor(scope: App, id: string, config: AppStackConfig) {
    super(scope, id, 'app', {
      ...config,
      user: envConfig.user,
    })

    new ArchiveProvider(this, 'archive-provider')

    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.networkInfraRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'network'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infra', 'network'),
      },
    )

    this.projectId = this.appProjectRemoteState.getString('project-id')
    this.projectName = this.appProjectRemoteState.getString('project-name')
    this.projectNumber = this.appProjectRemoteState.getString('project-number')
    this.vpcConnectorId =
      this.networkInfraRemoteState.getString('vpc-connector-id')
    this.vpcProjectId = this.networkInfraRemoteState.getString('vpc-project-id')

    const serviceAccountId = this.id()
    this.stackServiceAccount = new ServiceAccount(this, serviceAccountId, {
      accountId: serviceAccountId,
      description: `A generated service account for project '${this.projectId}'`,
      project: this.projectId,
    })
    const serviceAccount = `serviceAccount:${this.stackServiceAccount.email}`

    new ProjectIamMember(
      this,
      this.id('iam', 'secretmanager', 'secret', 'accessor'),
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

    new ProjectIamMember(
      this,
      this.id('iam', 'binding', 'vpcaccess', 'admin'),
      {
        member: serviceAccount,
        project: this.projectId,
        role: 'roles/vpcaccess.admin',
      },
    )

    if (config.databases.includes('firestore')) {
      this.firestoreInfraRemoteState = new DataTerraformRemoteStateGcs(
        this,
        this.id('remote', 'state', 'firestore'),
        {
          bucket: envConfig.bucket,
          prefix: this.remotePrefix('infra', 'firestore'),
        },
      )

      this.firestoreDatabaseProjectId =
        this.firestoreInfraRemoteState.getString(
          'firestore-database-project-id',
        )
      this.firestoreDatabaseName = this.firestoreInfraRemoteState.getString(
        'firestore-database-name',
      )

      new ProjectIamMember(
        this,
        this.id('iam', 'service', 'account', 'user', 'firestore'),
        {
          dependsOn: [this.stackServiceAccount],
          member: serviceAccount,
          project: this.firestoreDatabaseProjectId,
          role: 'roles/datastore.user',
        },
      )
    }

    if (config.databases.includes('cloudsql')) {
      this.sqlInfraRemoteState = new DataTerraformRemoteStateGcs(
        this,
        this.id('remote', 'state', 'sql'),
        {
          bucket: envConfig.bucket,
          prefix: this.remotePrefix('infra', 'sql'),
        },
      )

      this.sqlDbInstanceId =
        this.sqlInfraRemoteState.getString('db-instance-id')
      this.sqlDbProjectId = this.sqlInfraRemoteState.getString('db-project-id')

      // this.stackServiceAccount.email.replace('.gserviceaccount.com', '') didn't work.
      //  ¯\_(ツ)_/¯
      // It's the same as this: `${this.id()}@${this.projectId}.iam`

      new SqlUser(this, this.id('iam', 'service', 'account', 'user'), {
        dependsOn: [this.stackServiceAccount],
        instance: this.sqlDbInstanceId,
        name: `${this.id()}@${this.projectId}.iam`,
        project: this.sqlDbProjectId,
        type: 'CLOUD_IAM_SERVICE_ACCOUNT',
      })

      new ProjectIamMember(
        this,
        this.id('iam', 'service', 'account', 'user', 'sql'),
        {
          dependsOn: [this.stackServiceAccount],
          member: serviceAccount,
          project: this.projectId,
          role: 'roles/cloudsql.client',
        },
      )

      const sqlId = this.id('sql', 'user')
      this.sqlUser = new SqlUser(this, sqlId, {
        instance: this.sqlDbInstanceId,
        name: sqlId,
        project: this.sqlDbProjectId,
        password: new Password(this, this.id('sql', 'user', 'password'), {
          length: 16,
          special: false,
        }).result,
      })

      const secretId = this.id('secret', 'sql', 'password')
      this.sqlSecret = new SecretManagerSecret(this, secretId, {
        project: this.projectId,
        replication: { auto: {} },
        secretId,
      })
    }
  }
}
