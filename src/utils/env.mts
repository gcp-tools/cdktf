import { env } from 'node:process'
import { z } from 'zod/v4'

const arraySchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.string().array())

export const envSchema = z.object({
  GCP_TOOLS_BILLING_ACCOUNT: z.string(),
  GCP_TOOLS_CI_ENVIRONMENTS: z
    .string()
    .transform((value) => value.split(','))
    .pipe(
      z.tuple([
        z.literal('dev'),
        z.literal('test'),
        z.literal('sbx'),
        z.literal('prod'),
      ]),
    ),
  GCP_TOOLS_ORG_ID: z.string(),
  GCP_TOOLS_OWNER_EMAILS: arraySchema,
  GCP_TOOLS_ENVIRONMENT: z.union([
    z.literal('dev'),
    z.literal('test'),
    z.literal('sbx'),
    z.literal('prod'),
  ]),
  GCP_TOOLS_REGIONS: arraySchema,
  GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID: z.string(),
  GCP_TOOLS_USER: z.string(),
  GCP_TOOLS_PROJECT_ID: z.string(),
  GCP_TOOLS_FOUNDATION_PROJECT_ID: z.string(),
  GCP_TOOLS_FOUNDATION_PROJECT_NUMBER: z.string(),
  GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER: z.string(),
  GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER: z.string(),
})

export type Env = z.infer<typeof envSchema>
export type EnvConfig = {
  bucket: string
  ciEnvironments: string[]
  environment: string
  regions: string[]
  billingAccount: string
  orgId: string
  owners: string[]
  user: string
  projectId: string
  foundationProjectId: string
  foundationProjectNumber: string
  githubIdentitySpecifier: string
  developerIdentitySpecifier: string
}

const parsedResult = envSchema.safeParse(env)
if (!parsedResult.success) {
  console.error(
    '❌ Invalid environment variables:',
    JSON.stringify(parsedResult.error.issues, null, 2),
  )
  process.exit(1)
}

export const envVars: Env = parsedResult.data
export const envConfig: EnvConfig = {
  billingAccount: envVars.GCP_TOOLS_BILLING_ACCOUNT,
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
  ciEnvironments: envVars.GCP_TOOLS_CI_ENVIRONMENTS,
  environment: envVars.GCP_TOOLS_ENVIRONMENT,
  orgId: envVars.GCP_TOOLS_ORG_ID,
  owners: envVars.GCP_TOOLS_OWNER_EMAILS,
  projectId: envVars.GCP_TOOLS_PROJECT_ID,
  regions: envVars.GCP_TOOLS_REGIONS,
  user: envVars.GCP_TOOLS_USER,
  foundationProjectId: envVars.GCP_TOOLS_FOUNDATION_PROJECT_ID,
  foundationProjectNumber: envVars.GCP_TOOLS_FOUNDATION_PROJECT_NUMBER,
  githubIdentitySpecifier: envVars.GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER,
  developerIdentitySpecifier: envVars.GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER,
}
