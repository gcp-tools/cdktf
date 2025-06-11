import { ProjectIamBinding } from '@cdktf/provider-google/lib/project-iam-binding/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'
export type IamInfraStackConfig = Record<string, never>

export class IamInfraStack extends BaseInfraStack<IamInfraStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected networkInfraRemoteState: DataTerraformRemoteStateGcs
  public cloudFunctionServiceAgent: string
  public cloudRunServiceAgent: string
  public computeEngineServiceAgent: string
  public googleAPIsServiceAgent: string
  public cloudStorageServiceAgent: string
  public appProjectId: string
  public appProjectNumber: string
  public vpcProjectId: string

  constructor(scope: App, config: IamInfraStackConfig) {
    super(scope, 'iam', config)

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

    this.appProjectId = this.appProjectRemoteState.getString('project-id')
    this.appProjectNumber =
      this.appProjectRemoteState.getString('project-number')
    this.vpcProjectId = this.networkInfraRemoteState.getString('vpc-project-id')

    this.cloudFunctionServiceAgent = `serviceAccount:service-${this.appProjectNumber}@gcf-admin-robot.iam.gserviceaccount.com`
    this.cloudRunServiceAgent = `serviceAccount:service-${this.appProjectNumber}@serverless-robot-prod.iam.gserviceaccount.com`
    this.cloudStorageServiceAgent = `serviceAccount:service-${this.appProjectNumber}@gs-project-accounts.iam.gserviceaccount.com`
    this.computeEngineServiceAgent = `serviceAccount:${this.appProjectNumber}-compute@developer.gserviceaccount.com`
    this.googleAPIsServiceAgent = `serviceAccount:${this.appProjectNumber}@cloudservices.gserviceaccount.com`

    new ProjectIamBinding(
      this,
      this.id('iam', 'binding', 'artifact', 'registry', 'reader'),
      {
        members: [
          this.cloudFunctionServiceAgent,
          this.cloudRunServiceAgent,
          this.computeEngineServiceAgent,
        ],
        project: this.appProjectId,
        role: 'roles/artifactregistry.reader',
      },
    )

    new ProjectIamBinding(
      this,
      this.id('iam', 'binding', 'artifact', 'registry', 'writer'),
      {
        members: [
          this.cloudFunctionServiceAgent,
          this.cloudRunServiceAgent,
          this.computeEngineServiceAgent,
        ],
        project: this.appProjectId,
        role: 'roles/artifactregistry.writer',
      },
    )

    new ProjectIamBinding(
      this,
      this.id('iam', 'binding', 'vpcaccess', 'admin'),
      {
        members: [this.cloudFunctionServiceAgent, this.cloudRunServiceAgent],
        project: this.appProjectId,
        role: 'roles/vpcaccess.admin',
      },
    )

    new ProjectIamBinding(
      this,
      this.id('iam', 'binding', 'host', 'vpcaccess', 'user', 'cf'),
      {
        members: [this.cloudFunctionServiceAgent, this.cloudRunServiceAgent],
        project: this.vpcProjectId,
        role: 'roles/vpcaccess.user',
      },
    )

    // new ProjectIamMember(this, this.id('iam', 'compute', 'object', 'viewer'), {
    //   member: this.cloudStorageServiceAgent,
    //   project: this.projectId,
    //   role: 'roles/storage.objectViewer',
    // })

    new ProjectIamMember(
      this,
      this.id('iam', 'member', 'logging', 'log', 'writer'),
      {
        member: this.computeEngineServiceAgent,
        project: this.appProjectId,
        role: 'roles/logging.logWriter',
      },
    )

    new StorageBucketIamBinding(
      this,
      this.id('iam', 'compute', 'object', 'viewer'),
      {
        bucket: `gcf-v2-sources-${this.appProjectNumber}-${envConfig.regions[0]}`,
        members: [this.computeEngineServiceAgent],
        role: 'roles/storage.objectViewer',
      },
    )
  }
}
