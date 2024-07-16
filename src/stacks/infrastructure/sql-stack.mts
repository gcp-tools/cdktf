import { ComputeGlobalAddress } from '@cdktf/provider-google/lib/compute-global-address/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { ServiceAccount } from '@cdktf/provider-google/lib/service-account/index.js'
import { ServiceNetworkingConnection } from '@cdktf/provider-google/lib/service-networking-connection/index.js'
import { SqlDatabaseInstance } from '@cdktf/provider-google/lib/sql-database-instance/index.js'
import { SqlDatabase } from '@cdktf/provider-google/lib/sql-database/index.js'
import { StringResource } from '@cdktf/provider-random/lib/string-resource/index.js'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { Construct } from 'constructs'
import { InfraStack, type InfraStackConfig } from '../infra-stack.mjs'

export type SqlStackConfig = InfraStackConfig & {}

export class SqlStack extends InfraStack {
  protected db: SqlDatabaseInstance
  protected dbConnection: ServiceNetworkingConnection
  protected dbRemoteState: DataTerraformRemoteStateGcs
  protected dbServiceAccount: ServiceAccount
  protected hostRemoteState: DataTerraformRemoteStateGcs
  protected networkRemoteState: DataTerraformRemoteStateGcs

  constructor(scope: Construct, config: SqlStackConfig) {
    super(scope, 'sql', config)

    this.hostRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'host'),
      {
        bucket: config.bucket,
        prefix: this.remotePrefix('project', 'host'),
      },
    )

    this.dbRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'db'),
      {
        bucket: config.bucket,
        prefix: this.remotePrefix('project', 'db'),
      },
    )

    this.networkRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'network'),
      {
        bucket: config.bucket,
        prefix: this.remotePrefix('infra', 'network'),
      },
    )

    const dbProjectId = this.dbRemoteState.getString('project-id')
    const hostProjectId = this.hostRemoteState.getString('project-id')
    const vpcId = this.networkRemoteState.getString('vpc-id')
    const privateIpAllodId = this.id('private', 'ip', 'alloc')

    new ComputeGlobalAddress(this, privateIpAllodId, {
      address: '10.252.0.0',
      addressType: 'INTERNAL',
      name: privateIpAllodId, // something random?
      network: vpcId,
      prefixLength: 16,
      project: hostProjectId,
      purpose: 'VPC_PEERING',
    })

    this.dbConnection = new ServiceNetworkingConnection(
      this,
      this.id('database', 'connection'),
      {
        network: vpcId,
        reservedPeeringRanges: [privateIpAllodId],
        service: 'servicenetworking.googleapis.com',
      },
    )

    const databaseId = this.id('db', 'instance')
    this.db = new SqlDatabaseInstance(this, databaseId, {
      databaseVersion: 'POSTGRES_14',
      deletionProtection: false,
      dependsOn: [this.dbConnection],
      name: `${databaseId}-${
        new StringResource(this, this.id('random', 'id'), {
          length: 6,
          lower: true,
          upper: false,
          numeric: true,
          special: false,
        }).id
      }`,
      project: dbProjectId,
      settings: {
        databaseFlags: [
          {
            name: 'cloudsql.logical_decoding',
            value: 'on',
          },
          {
            name: 'cloudsql.iam_authentication',
            value: 'on',
          },
        ],
        ipConfiguration: {
          ipv4Enabled: true,
          privateNetwork: vpcId,
        },
        insightsConfig: {
          queryInsightsEnabled: true,
        },
        tier: 'db-f1-micro',
      },
    })

    new SqlDatabase(this, this.id('db', 'database'), {
      instance: this.db.name,
      name: 'pragma',
      project: dbProjectId,
    })

    const serviceAccount = this.id()
    this.dbServiceAccount = new ServiceAccount(this, serviceAccount, {
      accountId: serviceAccount,
      description: `A generated service account for project '${dbProjectId}'`,
      project: dbProjectId,
    })

    new ProjectIamMember(this, this.id('iam', 'sql', 'client'), {
      dependsOn: [this.dbServiceAccount],
      member: `serviceAccount:${this.dbServiceAccount.email}`,
      project: dbProjectId,
      role: 'roles/cloudsql.client',
    })


    new TerraformOutput(this, 'db-project-id', {
      value: dbProjectId,
    })

    new TerraformOutput(this, 'db-instance-id', {
      value: this.db.id,
    })

    new TerraformOutput(this, 'db-instance-name', {
      value: this.db.name,
    })
  }
}
