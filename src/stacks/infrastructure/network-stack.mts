import { ComputeNetwork } from '@cdktf/provider-google/lib/compute-network/index.js'
import { ComputeRouterNat } from '@cdktf/provider-google/lib/compute-router-nat/index.js'
import { ComputeRouter } from '@cdktf/provider-google/lib/compute-router/index.js'
import { ComputeSharedVpcHostProject } from '@cdktf/provider-google/lib/compute-shared-vpc-host-project/index.js'
import { ComputeSharedVpcServiceProject } from '@cdktf/provider-google/lib/compute-shared-vpc-service-project/index.js'
import { ComputeSubnetwork } from '@cdktf/provider-google/lib/compute-subnetwork/index.js'
import { VpcAccessConnector } from '@cdktf/provider-google/lib/vpc-access-connector/index.js'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { Construct } from 'constructs'
import { InfraStack } from '../infra-stack.mjs'
import { envVars } from '../../utils/env.mjs'

export type NetworkStackConfig = {}

const envConfig = {
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
  region: envVars.GCP_TOOLS_REGION,
}

export class NetworkStack extends InfraStack<NetworkStackConfig> {
  protected appRemoteState: DataTerraformRemoteStateGcs
  protected connector: VpcAccessConnector
  protected dbRemoteState: DataTerraformRemoteStateGcs
  protected hostRemoteState: DataTerraformRemoteStateGcs
  protected hostVpcProject: ComputeSharedVpcHostProject
  protected privateSecondaryIp: ComputeSubnetwork
  protected vpc: ComputeNetwork

  constructor(scope: Construct, config: NetworkStackConfig) {
    super(scope, 'network', config)

    this.hostRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'host'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'host'),
      },
    )

    this.dbRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'db'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'db'),
      },
    )

    this.appRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    const hostProjectId = this.hostRemoteState.getString('project-id')

    this.hostVpcProject = new ComputeSharedVpcHostProject(
      this,
      this.id('vpc', 'host', 'host'),
      {
        project: hostProjectId,
      },
    )

    new ComputeSharedVpcServiceProject(this, this.id('vpc', 'service', 'db'), {
      dependsOn: [this.hostVpcProject],
      hostProject: hostProjectId,
      serviceProject: this.dbRemoteState.getString('project-id'),
    })

    new ComputeSharedVpcServiceProject(this, this.id('vpc', 'service', 'app'), {
      dependsOn: [this.hostVpcProject],
      hostProject: hostProjectId,
      serviceProject: this.appRemoteState.getString('project-id'),
    })

    this.vpc = new ComputeNetwork(this, this.id('vpc', 'network'), {
      autoCreateSubnetworks: false,
      mtu: 1460,
      name: this.id('vpc'),
      project: hostProjectId,
      routingMode: 'REGIONAL',
    })

    this.privateSecondaryIp = new ComputeSubnetwork(
      this,
      this.id('private', 'secondary', 'ip'),
      {
        dependsOn: [this.vpc],
        ipCidrRange: '10.1.0.0/20',
        name: this.id('private', 'secondary', 'ip'),
        network: this.vpc.id,
        project: hostProjectId,
      },
    )

    const routerId = this.id('router')
    new ComputeRouter(this, routerId, {
      name: routerId,
      network: this.vpc.selfLink,
      project: hostProjectId,
    })

    const routerNatId = this.id('router', 'nat')
    new ComputeRouterNat(this, routerNatId, {
      dependsOn: [this.privateSecondaryIp],
      name: routerNatId,
      natIpAllocateOption: 'AUTO_ONLY',
      project: hostProjectId,
      router: routerId,
      sourceSubnetworkIpRangesToNat: 'ALL_SUBNETWORKS_ALL_IP_RANGES',
    })

    this.connector = new VpcAccessConnector(this, this.id('connector'), {
      dependsOn: [this.vpc],
      ipCidrRange: '10.8.0.0/28',
      // machineType: 'e2-standard-4',
      // maxInstances: 7,
      // maxThroughput: 700,
      // minInstances: 2,
      // minThroughput: 200,
      name: this.shortName('connector'),
      network: this.vpc.selfLink,
      project: hostProjectId,
    })

    new TerraformOutput(this, 'vpc-id', {
      value: this.vpc.id,
    })

    new TerraformOutput(this, 'vpc-project-id', {
      value: this.vpc.project,
    })

    new TerraformOutput(this, 'vpc-connector-id', {
      value: this.connector.id,
    })

  }
}
