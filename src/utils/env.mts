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

const rawEnv = {
  ...env,
  GCP_TOOLS_OWNER_EMAILS: `${env.GCP_TOOLS_OWNER_EMAILS}`.split(','),
}

export let envVars: Env
try {
  envVars = Value.Decode(envSchema, rawEnv)
} catch (err) {
  console.log(JSON.stringify([...Value.Errors(envSchema, rawEnv)], null, 2))
}
