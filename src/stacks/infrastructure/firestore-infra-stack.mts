import { FirestoreDatabase } from '@cdktf/provider-google/lib/firestore-database/index.js'
/**
 * Provisions a Firestore database in the data project.
 *
 * This stack creates a Firestore Native database instance. It is designed to
 * be deployed once per environment. For production environments, it is highly
 * recommended to enable deletion protection and point-in-time recovery.
 *
 * @example
 * ```ts
 * // A production-ready Firestore configuration
 * new FirestoreInfraStack(app, {
 *   locationId: 'eur3', // Or your desired multi-region
 *   deleteProtectionState: 'DELETE_PROTECTION_ENABLED',
 *   pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
 * })
 * ```
 *
 * @example
 * ```ts
 * // A development configuration with protections disabled
 * new FirestoreInfraStack(app, {
 *   locationId: 'europe-west1',
 * })
 * ```
 */
import { DataTerraformRemoteStateGcs } from 'cdktf'
import type { App } from 'cdktf'
import { TerraformOutput } from 'cdktf'
import { envConfig } from '../../utils/env.mjs'
import type { BaseStackConfig } from '../base-stack.mjs'
import { BaseInfraStack } from './base-infra-stack.mjs'

export type FirestoreStackConfig = BaseStackConfig & {
  name?: string
  deleteProtectionState?:
    | 'DELETE_PROTECTION_ENABLED'
    | 'DELETE_PROTECTION_DISABLED'
  pointInTimeRecoveryEnablement?:
    | 'POINT_IN_TIME_RECOVERY_ENABLED'
    | 'POINT_IN_TIME_RECOVERY_DISABLED'
}

export class FirestoreInfraStack extends BaseInfraStack<FirestoreStackConfig> {
  constructor(scope: App, config: FirestoreStackConfig) {
    super(scope, 'firestore', config)

    const mergedConfig = {
      name: '(default)',
      deleteProtectionState: 'DELETE_PROTECTION_DISABLED',
      pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
      ...config,
    }

    const dataProjectState = new DataTerraformRemoteStateGcs(
      this,
      this.id('remote', 'state', 'data', 'project'),
      {
        bucket: envConfig.bucket,
        prefix: this.remotePrefix('project', 'data'),
      },
    )

    const dataProjectId = dataProjectState.getString('project-id')

    const database = new FirestoreDatabase(
      this,
      this.id('firestore', 'database'),
      {
        deleteProtectionState: mergedConfig.deleteProtectionState,
        locationId: envConfig.regions[0],
        name: mergedConfig.name,
        pointInTimeRecoveryEnablement:
          mergedConfig.pointInTimeRecoveryEnablement,
        project: dataProjectId,
        type: 'FIRESTORE_NATIVE',
      },
    )

    new TerraformOutput(this, 'firestore-database-project-id', {
      value: dataProjectId,
    })

    new TerraformOutput(this, 'firestore-database-name', {
      value: database.name,
    })
  }
}
