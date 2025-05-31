/**
 * Load Balancer Infrastructure Stack
 *
 * This stack creates a global load balancer for the API Gateway, supporting:
 * - SSL/TLS with managed certificates
 * - Custom domains
 * - Cloud Armor security policies
 *
 * Usage example:
 * ```typescript
 * const stack = new LoadBalancerStack(app, {
 *   sslConfig: {
 *     domains: ['api.example.com', 'api2.example.com'],
 *     managedCertificate: true
 *   },
 *   securityConfig: {
 *     cloudArmor: {
 *       enabled: true,
 *       rules: [
 *         {
 *           action: 'deny(403)',
 *           description: 'Block SQL injection attempts',
 *           match: {
 *             expr: {
 *               expression: "evaluatePreconfiguredExpr('sqli-stable')"
 *             }
 *           },
 *           priority: 1000
 *         }
 *       ]
 *     }
 *   }
 * });
 * ```
 */

import { ComputeGlobalAddress } from '@cdktf/provider-google/lib/compute-global-address'
import { ComputeGlobalForwardingRule } from '@cdktf/provider-google/lib/compute-global-forwarding-rule'
import { ComputeManagedSslCertificate } from '@cdktf/provider-google/lib/compute-managed-ssl-certificate'
import { ComputeSecurityPolicy } from '@cdktf/provider-google/lib/compute-security-policy'
import { ComputeTargetHttpsProxy } from '@cdktf/provider-google/lib/compute-target-https-proxy'
import { ComputeUrlMap } from '@cdktf/provider-google/lib/compute-url-map'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envVars } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type CloudArmorRule = {
  action: string
  description: string
  match: {
    expr: {
      expression: string
    }
  }
  priority: number
}

export type LoadBalancerStackConfig = {
  sslConfig?: {
    domains: string[]
    managedCertificate?: boolean
  }
  securityConfig?: {
    cloudArmor?: {
      enabled: boolean
      rules?: CloudArmorRule[]
    }
  }
}

const envConfig = {
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
  region: envVars.GCP_TOOLS_REGION,
}

export class LoadBalancerStack extends BaseInfraStack<LoadBalancerStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected apiGatewayInfraRemoteState: DataTerraformRemoteStateGcs
  protected urlMap: ComputeUrlMap
  protected targetHttpsProxy: ComputeTargetHttpsProxy
  protected globalAddress: ComputeGlobalAddress
  protected forwardingRule: ComputeGlobalForwardingRule
  protected sslCertificate?: ComputeManagedSslCertificate
  protected securityPolicy?: ComputeSecurityPolicy

  constructor(scope: App, config: LoadBalancerStackConfig) {
    super(scope, 'load-balancer', config)

    // Get remote state for app project and API Gateway
    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.apiGatewayInfraRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'api-gateway'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('infrastructure', 'api-gateway'),
      },
    )

    const appProjectId = this.appProjectRemoteState.getString('project-id')
    const backendServiceId =
      this.apiGatewayInfraRemoteState.getString('backend-service-id')

    // Create URL map
    this.urlMap = new ComputeUrlMap(this, this.id('url', 'map'), {
      name: this.id('url-map'),
      project: appProjectId,
      defaultService: backendServiceId,
    })

    // Create SSL certificate if domains are provided
    if (config.sslConfig?.domains) {
      this.sslCertificate = new ComputeManagedSslCertificate(
        this,
        this.id('ssl', 'cert'),
        {
          name: this.id('ssl-cert'),
          project: appProjectId,
          managed: {
            domains: config.sslConfig.domains,
          },
        },
      )
    }

    // Create Cloud Armor security policy if enabled
    if (config.securityConfig?.cloudArmor?.enabled) {
      this.securityPolicy = new ComputeSecurityPolicy(
        this,
        this.id('security', 'policy'),
        {
          name: this.id('security-policy'),
          project: appProjectId,
          // Default rule to allow all traffic
          rule: [
            {
              action: 'allow',
              description: 'Default rule, higher priority overrides it',
              match: {
                versionedExpr: 'SRC_IPS_V1',
                config: {
                  srcIpRanges: ['*'],
                },
              },
              priority: 2147483647,
              preview: false,
            },
            // Add custom rules if provided
            ...(config.securityConfig.cloudArmor.rules || []),
          ],
        },
      )
    }

    // Create target HTTPS proxy
    this.targetHttpsProxy = new ComputeTargetHttpsProxy(
      this,
      this.id('target', 'proxy'),
      {
        name: this.id('target-proxy'),
        project: appProjectId,
        urlMap: this.urlMap.id,
        sslCertificates: this.sslCertificate
          ? [this.sslCertificate.id]
          : undefined,
      },
    )

    // Create global IP address
    this.globalAddress = new ComputeGlobalAddress(
      this,
      this.id('global', 'address'),
      {
        name: this.id('global-ip'),
        project: appProjectId,
      },
    )

    // Create forwarding rule
    this.forwardingRule = new ComputeGlobalForwardingRule(
      this,
      this.id('forwarding', 'rule'),
      {
        name: this.id('forwarding-rule'),
        project: appProjectId,
        target: this.targetHttpsProxy.id,
        ipAddress: this.globalAddress.address,
        portRange: '443',
      },
    )

    // Outputs
    new TerraformOutput(this, 'global-ip', {
      value: this.globalAddress.address,
    })

    new TerraformOutput(this, 'forwarding-rule-id', {
      value: this.forwardingRule.id,
    })

    if (this.sslCertificate) {
      new TerraformOutput(this, 'ssl-certificate-id', {
        value: this.sslCertificate.id,
      })
    }

    if (this.securityPolicy) {
      new TerraformOutput(this, 'security-policy-id', {
        value: this.securityPolicy.id,
      })
    }
  }
}
