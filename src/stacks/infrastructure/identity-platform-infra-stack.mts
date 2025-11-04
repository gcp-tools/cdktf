import { ProjectIamMember } from '@cdktf/provider-google/lib/project-iam-member/index.js'
import { IdentityPlatformConfig } from '@cdktf/provider-google/lib/identity-platform-config/index.js'
import { DataTerraformRemoteStateGcs, TerraformOutput } from 'cdktf'
import type { App } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type IdentityPlatformInfraStackConfig = Record<string, never>

/**
 * Provisions Identity Platform (Firebase Auth) configuration in the app project.
 *
 * This stack creates the Identity Platform configuration with email/password
 * authentication, MFA support, and authorized domains. It also grants the
 * IdentityStack service account the firebaseauth.admin role.
 *
 * @example
 * ```ts
 * new IdentityPlatformInfraStack(app, {})
 * ```
 */
export class IdentityPlatformInfraStack extends BaseInfraStack<IdentityPlatformInfraStackConfig> {
  protected appProjectRemoteState: DataTerraformRemoteStateGcs
  protected identityAppRemoteState: DataTerraformRemoteStateGcs
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

    this.identityAppRemoteState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'identity'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('app', 'identity'),
      },
    )

    this.appProjectId = this.appProjectRemoteState.getString('project-id')

    this.idpConfig = new IdentityPlatformConfig(
      this,
      this.id('idp', 'config'),
      {
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

    const identityServiceAccountEmail = this.identityAppRemoteState.getString(
      'service-account-email',
    )

    new ProjectIamMember(
      this,
      this.id('sa', 'firebase', 'admin'),
      {
        dependsOn: [this.idpConfig],
        member: `serviceAccount:${identityServiceAccountEmail}`,
        project: this.appProjectId,
        role: 'roles/firebaseauth.admin',
        provider: this.googleProvider,
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

