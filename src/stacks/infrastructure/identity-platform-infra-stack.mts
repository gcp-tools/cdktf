import { IdentityPlatformConfig } from '@cdktf/provider-google/lib/identity-platform-config/index.js'
import { GoogleProvider } from '@cdktf/provider-google/lib/provider/index.js'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type IdentityPlatformInfraStackConfig = Record<string, never>

/**
 * Provisions Identity Platform (Firebase Auth) configuration in the app project.
 *
 * This stack creates the Identity Platform configuration with email/password
 * authentication, MFA support, and authorized domains.
 *
 * @example
 * ```ts
 * new IdentityPlatformInfraStack(app, {})
 * ```
 */
export class IdentityPlatformInfraStack extends BaseInfraStack<IdentityPlatformInfraStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  public readonly idpConfig: IdentityPlatformConfig
  public appProjectId: string

  constructor(scope: App, config: IdentityPlatformInfraStackConfig) {
    super(scope, 'identity-platform', config)

    this.appProjectRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'app'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'app'),
      },
    )

    this.appProjectId = this.appProjectRemoteState.getString('project-id')


    const googleProvider = new GoogleProvider(
      this,
      this.id('provider', 'google', 'identity', 'platform'),
      {
        project: this.appProjectId,
        billingProject: this.appProjectId,
        userProjectOverride: true,
      },
    );


    this.idpConfig = new IdentityPlatformConfig(
      this,
      this.id('idp', 'config'),
      {
        provider: googleProvider,
        authorizedDomains: [
          ...(envConfig.environment !== 'prod' ? ['localhost'] : []),
          `${this.appProjectId}.firebaseapp.com`,
          `${this.appProjectId}.web.app`,
        ],
        client: {
          permissions: {
            disabledUserDeletion: true,
            disabledUserSignup: false,
          },
        },
        mfa: {
          enabledProviders: ['PHONE_SMS'],
          state: 'ENABLED',
        },
        monitoring: {
          requestLogging: {
            enabled: true,
          },
        },
        project: this.appProjectId,
        signIn: {
          allowDuplicateEmails: false,
          email: {
            enabled: true,
            passwordRequired: true,
          },
        },
      },
    )

    new TerraformOutput(this, 'idp-client-api-key', {
      description: 'The API key of the IDP client.',
      value: this.idpConfig.client.apiKey,
      sensitive: true,
    })

    new TerraformOutput(this, 'idp-client-auth-domain', {
      description: 'The auth domain of the IDP client.',
      value: `${this.idpConfig.client.firebaseSubdomain}.firebaseapp.com`,
      sensitive: true,
    })
  }
}
