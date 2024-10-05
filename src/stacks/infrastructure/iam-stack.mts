import { ProjectIamBinding } from '@cdktf/provider-google/lib/project-iam-binding/index.js'
import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { StorageBucketIamBinding } from '@cdktf/provider-google/lib/storage-bucket-iam-binding/index.js'
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { Construct } from 'constructs'
import { InfraStack } from '../infra-stack.mjs'
import { envVars } from '../../utils/env.mjs'
export type IamStackConfig = {}

const envConfig = {
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
  region: envVars.GCP_TOOLS_REGION,
}


export class IamStack extends InfraStack<IamStackConfig> {
  protected appRemoteState: DataTerraformRemoteStateGcs
  protected networkRemoteState: DataTerraformRemoteStateGcs
  public cloudFunctionServiceAgent: string
  public cloudRunServiceAgent: string
  public computeEngineServiceAgent: string
  public googleAPIsServiceAgent: string
  public cloudStorageServiceAgent: string
  public projectId: string
  public projectNumber: string
  public vpcProjectId: string

  constructor(scope: Construct, config: IamStackConfig) {
    super(scope, 'iam', config)

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

    this.projectId = this.appRemoteState.getString('project-id')
    this.projectNumber = this.appRemoteState.getString('project-number')
    this.vpcProjectId = this.networkRemoteState.getString('vpc-project-id')

    this.cloudFunctionServiceAgent = `serviceAccount:service-${this.projectNumber}@gcf-admin-robot.iam.gserviceaccount.com`;
    this.cloudRunServiceAgent = `serviceAccount:service-${this.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`;
    this.cloudStorageServiceAgent = `serviceAccount:service-${this.projectNumber}@gs-project-accounts.iam.gserviceaccount.com`;
    this.computeEngineServiceAgent = `serviceAccount:${this.projectNumber}-compute@developer.gserviceaccount.com`;
    this.googleAPIsServiceAgent = `serviceAccount:${this.projectNumber}@cloudservices.gserviceaccount.com`;

    new ProjectIamBinding(this, this.id('iam', 'binding', 'artifact', 'registry', 'reader'), {
      members: [
        this.cloudFunctionServiceAgent,
        this.cloudRunServiceAgent,
        this.computeEngineServiceAgent,
      ],
      project: this.projectId,
      role: 'roles/artifactregistry.reader',
    });

    new ProjectIamBinding(this, this.id('iam', 'binding', 'artifact', 'registry', 'writer'), {
      members: [
        this.cloudFunctionServiceAgent,
        this.cloudRunServiceAgent,
        this.computeEngineServiceAgent,
      ],
      project: this.projectId,
      role: 'roles/artifactregistry.writer',
    });

    new ProjectIamBinding(this, this.id('iam', 'binding', 'vpcaccess', 'admin'), {
      members: [
        this.cloudFunctionServiceAgent,
        this.cloudRunServiceAgent,
      ],
      project: this.projectId,
      role: 'roles/vpcaccess.admin',
    });

    new ProjectIamBinding(this, this.id('iam', 'binding', 'host', 'vpcaccess', 'user', 'cf'), {
      members: [
        this.cloudFunctionServiceAgent,
        this.cloudRunServiceAgent,
      ],
      project: this.vpcProjectId,
      role: 'roles/vpcaccess.user',
    });

    // new ProjectIamMember(this, this.id('iam', 'compute', 'object', 'viewer'), {
    //   member: this.cloudStorageServiceAgent,
    //   project: this.projectId,
    //   role: 'roles/storage.objectViewer',
    // })

    new ProjectIamMember(this, this.id('iam', 'member', 'logging', 'log', 'writer'), {
      member: this.computeEngineServiceAgent,
      project: this.projectId,
      role: 'roles/logging.logWriter'
    })

    new StorageBucketIamBinding(this, this.id('iam', 'compute', 'object', 'viewer'), {
      bucket: `gcf-v2-sources-${this.projectNumber}-${envConfig.region}`,
      members: [
        this.computeEngineServiceAgent
      ],
      role: 'roles/storage.objectViewer',
    })

  }
}
