/**
 * A project stack for data-related services.
 *
 * This stack enables the common APIs required for a data project to participate
 * in a Shared VPC and manage secrets. Specific database APIs should be passed
 * in during instantiation.
 *
 * @example
 * ```ts
 * new DataProjectStack(app, 'my-data-project', {
 *   apis: ['sqladmin', 'bigquery'],
 * })
 * ```
 */

import type { App } from 'cdktf'
import {
  BaseProjectStack,
  type ProjectStackConfig,
} from './base-project-stack.mjs'

const dataProjectApis = ['servicenetworking', 'secretmanager']

/**
 * A project stack for hosting data services like Firestore.
 */
export class DataProjectStack extends BaseProjectStack {
  constructor(scope: App, config: ProjectStackConfig = { apis: [] }) {
    super(scope, 'data', {
      apis: [...dataProjectApis, ...config.apis],
    })
  }
}
