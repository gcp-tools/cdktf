import { env } from 'node:process'

import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const envSchema = Type.Object({
  GCP_TOOLS_BILLING_ACCOUNT: Type.String(),
  GCP_TOOLS_ORG_ID: Type.String(),
  GCP_TOOLS_OWNER_EMAILS: Type.Array(Type.String(), { minItems: 1 }),
  GCP_TOOLS_ENVIRONMENT: Type.Union([
    Type.Literal('dev'),
    Type.Literal('qa'),
    Type.Literal('prod'),
  ]),
  GCP_TOOLS_REGION: Type.String(),
  GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID: Type.String(),
  GCP_TOOLS_USER: Type.String(),
})
export type Env = Static<typeof envSchema>
export type EnvConfig = {
  bucket: string
  environment: string
  region: string
  billingAccount: string
  orgId: string
  owners: string[]
  user: string
}

const rawEnv = {
  ...env,
  GCP_TOOLS_OWNER_EMAILS: `${env.GCP_TOOLS_OWNER_EMAILS}`.split(','),
}

export let envVars: Env
export let envConfig: EnvConfig
try {
  envVars = Value.Decode(envSchema, rawEnv)
  envConfig = {
    billingAccount: envVars.GCP_TOOLS_BILLING_ACCOUNT,
    bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
    environment: envVars.GCP_TOOLS_ENVIRONMENT,
    orgId: envVars.GCP_TOOLS_ORG_ID,
    owners: envVars.GCP_TOOLS_OWNER_EMAILS,
    region: envVars.GCP_TOOLS_REGION,
    user: envVars.GCP_TOOLS_USER,
  }
} catch (err) {
  console.log(JSON.stringify([...Value.Errors(envSchema, rawEnv)], null, 2))
}
