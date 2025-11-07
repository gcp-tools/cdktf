import { FirestoreDatabase } from '@cdktf/provider-google/lib/firestore-database/index.js'
import { FirestoreIndex } from '@cdktf/provider-google/lib/firestore-index/index.js'
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

export type FirestoreIndexField =
  | {
      readonly fieldPath: string
      readonly order: 'ASCENDING' | 'DESCENDING'
    }
  | {
      readonly fieldPath: string
      readonly arrayConfig: 'CONTAINS'
    }

export type FirestoreCompositeIndex = {
  readonly id: string
  readonly collection: string
  readonly fields: readonly FirestoreIndexField[]
  readonly queryScope?:
    | 'COLLECTION'
    | 'COLLECTION_GROUP'
    | 'COLLECTION_RECURSIVE'
  readonly apiScope?:
    | 'ANY_API'
    | 'DATASTORE_MODE_API'
    | 'MONGODB_COMPATIBLE_API'
  readonly database?: string
}

export type FirestoreStackConfig = BaseStackConfig & {
  name?: string
  deleteProtectionState?:
    | 'DELETE_PROTECTION_ENABLED'
    | 'DELETE_PROTECTION_DISABLED'
  pointInTimeRecoveryEnablement?:
    | 'POINT_IN_TIME_RECOVERY_ENABLED'
    | 'POINT_IN_TIME_RECOVERY_DISABLED'
  indexes?: readonly FirestoreCompositeIndex[]
}

export class FirestoreInfraStack extends BaseInfraStack<FirestoreStackConfig> {
  constructor(scope: App, config: FirestoreStackConfig) {
    super(scope, 'firestore', config)

    const {
      name = '(default)',
      deleteProtectionState = 'DELETE_PROTECTION_DISABLED',
      pointInTimeRecoveryEnablement = 'POINT_IN_TIME_RECOVERY_DISABLED',
      indexes = [],
    } = config

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
        deleteProtectionState,
        locationId: envConfig.regions[0],
        name,
        pointInTimeRecoveryEnablement,
        project: dataProjectId,
        type: 'FIRESTORE_NATIVE',
      },
    )

    for (const index of indexes) {
      const resource = new FirestoreIndex(
        this,
        this.id('firestore', 'index', index.id),
        {
          apiScope: index.apiScope,
          collection: index.collection,
          database: index.database ?? name,
          fields: index.fields.map((field) => ({
            fieldPath: field.fieldPath,
            order: 'order' in field ? field.order : undefined,
            arrayConfig: 'arrayConfig' in field ? field.arrayConfig : undefined,
          })),
          project: dataProjectId,
          queryScope: index.queryScope,
        },
      )

      resource.node.addDependency(database)
    }

    new TerraformOutput(this, 'firestore-database-project-id', {
      value: dataProjectId,
    })

    new TerraformOutput(this, 'firestore-database-name', {
      value: database.name,
    })
  }
}
