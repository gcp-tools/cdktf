/**
 * Load Balancer Construct
 *
 * This Construct creates a global load balancer for the API Gateway, supporting:
 * - SSL/TLS with managed certificates
 * - Custom domains
 * - Cloud Armor security policies
 *
 * Usage example:
 * ```typescript
 * const stack = new LoadBalancerConstruct(this, {
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

import {
  computeGlobalAddress,
  computeGlobalForwardingRule,
  computeManagedSslCertificate,
  computeSecurityPolicy,
  computeTargetHttpsProxy,
  computeUrlMap,
} from '@cdktf/provider-google'
import { TerraformOutput } from 'cdktf'
import type { IngressStack } from '../stacks/ingress-stack.mjs'
import { BaseIngressConstruct } from './base-ingress-construct.mjs'

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

export type LoadBalancerConfig = {
  defaultBackendServiceId: string
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

export class LoadBalancerConstruct extends BaseIngressConstruct<LoadBalancerConfig> {
  protected globalAddress: computeGlobalAddress.ComputeGlobalAddress
  protected sslCertificate: computeManagedSslCertificate.ComputeManagedSslCertificate
  protected securityPolicy: computeSecurityPolicy.ComputeSecurityPolicy
  protected urlMap: computeUrlMap.ComputeUrlMap
  protected targetProxy: computeTargetHttpsProxy.ComputeTargetHttpsProxy
  protected forwardingRule: computeGlobalForwardingRule.ComputeGlobalForwardingRule

  constructor(scope: IngressStack, config: LoadBalancerConfig) {
    super(scope, 'load-balancer', config)

    // Create a global IP address
    this.globalAddress = new computeGlobalAddress.ComputeGlobalAddress(
      this,
      this.id('global', 'address'),
      {
        name: this.id('global-ip'),
        project: scope.hostProjectId,
      },
    )

    // Create a managed SSL certificate
    this.sslCertificate =
      new computeManagedSslCertificate.ComputeManagedSslCertificate(
        this,
        this.id('ssl', 'certificate'),
        {
          name: this.id('ssl-cert'),
          project: scope.hostProjectId,
          managed: {
            domains: config.sslConfig?.domains ?? [],
          },
        },
      )

    // Create a security policy
    this.securityPolicy = new computeSecurityPolicy.ComputeSecurityPolicy(
      this,
      this.id('security', 'policy'),
      {
        name: this.id('security-policy'),
        project: scope.hostProjectId,
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
          ...(config.securityConfig?.cloudArmor?.rules || []),
        ],
      },
    )

    // Create a URL map
    this.urlMap = new computeUrlMap.ComputeUrlMap(this, this.id('url', 'map'), {
      name: this.id('lb-url-map'),
      project: scope.hostProjectId,
      defaultService: config.defaultBackendServiceId,
      // TODO: add custom rules if provided to map to the correct backend service
    })

    // Create a target HTTPS proxy
    this.targetProxy = new computeTargetHttpsProxy.ComputeTargetHttpsProxy(
      this,
      this.id('target', 'proxy'),
      {
        name: this.id('target-proxy'),
        project: scope.hostProjectId,
        urlMap: this.urlMap.id,
        sslCertificates: this.sslCertificate
          ? [this.sslCertificate.id]
          : undefined,
      },
    )

    // Create a global forwarding rule
    this.forwardingRule =
      new computeGlobalForwardingRule.ComputeGlobalForwardingRule(
        this,
        this.id('forwarding', 'rule'),
        {
          name: this.id('forwarding-rule'),
          project: scope.hostProjectId,
          target: this.targetProxy.id,
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
