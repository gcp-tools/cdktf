/**
 * Creates the core networking infrastructure for the platform.
 *
 * This stack is responsible for setting up the Shared VPC, subnetwork,
 * NAT, router, and the Serverless VPC Access Connector.
 *
 * @example
 * // Instance-based scaling
 * new NetworkInfraStack(app, {
 *   subnetworkCidr: '10.1.0.0/20',
 *   connectorCidr: '10.8.0.0/28',
 *   scaling: {
 *     type: 'INSTANCES',
 *     data: {
 *       minInstances: 2,
 *       maxInstances: 7,
 *       machineType: 'e2-standard-4',
 *     }
 *   }
 * })
 *
 * @example
 * // Throughput-based scaling
 * new NetworkInfraStack(app, {
 *   subnetworkCidr: '10.1.0.0/20',
 *   connectorCidr: '10.8.0.0/28',
 *   scaling: {
 *     type: 'THROUGHPUT',
 *     data: {
 *       minThroughput: 200,
 *       maxThroughput: 300,
 *     }
 *   }
 * })
 */
import { ComputeNetwork } from '@cdktf/provider-google/lib/compute-network/index.js'
import { ComputeRouterNat } from '@cdktf/provider-google/lib/compute-router-nat/index.js'
import { ComputeRouter } from '@cdktf/provider-google/lib/compute-router/index.js'
import { ComputeSharedVpcHostProject } from '@cdktf/provider-google/lib/compute-shared-vpc-host-project/index.js'
import { ComputeSharedVpcServiceProject } from '@cdktf/provider-google/lib/compute-shared-vpc-service-project/index.js'
import { ComputeSubnetwork } from '@cdktf/provider-google/lib/compute-subnetwork/index.js'
import { VpcAccessConnector } from '@cdktf/provider-google/lib/vpc-access-connector/index.js'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envVars } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

type Scaling =
  | {
      type: 'INSTANCES'
      data: {
        minInstances: number
        maxInstances: number
        machineType?: string
      }
    }
  | {
      type: 'THROUGHPUT'
      data: {
        minThroughput: number
        maxThroughput: number
      }
    }

export type NetworkInfraStackConfig = {
  subnetworkCidr: string
  connectorCidr: string
  scaling?: Scaling
}

const envConfig = {
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
}

export class NetworkInfraStack extends BaseInfraStack<NetworkInfraStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected connector?: VpcAccessConnector
  protected dataProjectRemoteState: DataTerraformRemoteStateGcs
  protected hostProjectRemoteState: DataTerraformRemoteStateGcs
  protected hostVpcProject: ComputeSharedVpcHostProject
  protected privateSecondaryIp: ComputeSubnetwork
  protected vpc: ComputeNetwork

  constructor(scope: App, config: NetworkInfraStackConfig) {
    super(scope, 'network', config)

    this.hostProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'host'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'host'),
      },
    )

    this.dataProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'data'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'data'),
      },
    )

    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    const hostProjectId = this.hostProjectRemoteState.getString('project-id')

    this.hostVpcProject = new ComputeSharedVpcHostProject(
      this,
      this.id('vpc', 'host', 'host'),
      {
        project: hostProjectId,
      },
    )

    new ComputeSharedVpcServiceProject(
      this,
      this.id('vpc', 'service', 'data'),
      {
        dependsOn: [this.hostVpcProject],
        hostProject: hostProjectId,
        serviceProject: this.dataProjectRemoteState.getString('project-id'),
      },
    )

    new ComputeSharedVpcServiceProject(this, this.id('vpc', 'service', 'app'), {
      dependsOn: [this.hostVpcProject],
      hostProject: hostProjectId,
      serviceProject: this.appProjectRemoteState.getString('project-id'),
    })

    this.vpc = new ComputeNetwork(this, this.id('vpc', 'network'), {
      autoCreateSubnetworks: false,
      mtu: 1460,
      name: this.id('vpc'),
      project: hostProjectId,
      routingMode: 'GLOBAL',
    })

    this.privateSecondaryIp = new ComputeSubnetwork(
      this,
      this.id('private', 'secondary', 'ip'),
      {
        dependsOn: [this.vpc],
        ipCidrRange: config.subnetworkCidr,
        name: this.id('private', 'secondary', 'ip'),
        network: this.vpc.id,
        project: hostProjectId,
        privateIpGoogleAccess: true,
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

    if (config.scaling) {
      this.connector = new VpcAccessConnector(this, this.id('connector'), {
        dependsOn: [this.vpc],
        ipCidrRange: config.connectorCidr,
        name: this.shortName('connector'),
        network: this.vpc.selfLink,
        project: hostProjectId,
        ...config.scaling.data,
      })

      new TerraformOutput(this, 'vpc-connector-id', {
        value: this.connector.id,
      })
    }

    new TerraformOutput(this, 'vpc-id', {
      value: this.vpc.id,
    })

    new TerraformOutput(this, 'vpc-project-id', {
      value: this.vpc.project,
    })
  }
}
