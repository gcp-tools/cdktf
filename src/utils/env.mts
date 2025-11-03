import { env } from 'node:process'
import { z } from 'zod/v4'

const arraySchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.string().array())

export const envSchema = z.object({
  GCP_TOOLS_BILLING_ACCOUNT: z.string(),
  GCP_TOOLS_CI_ENVIRONMENTS: arraySchema,
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
  GCP_TOOLS_PROJECT_NAME: z.string(),
  GCP_TOOLS_FOUNDATION_PROJECT_ID: z.string(),
  GCP_TOOLS_FOUNDATION_PROJECT_NUMBER: z.string(),
  GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER: z.string(),
  GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER: z.string(),
  GCP_TOOLS_SERVICE_ACCOUNT_EMAIL: z.string(),
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
  projectName: string
  foundationProjectId: string
  foundationProjectNumber: string
  githubIdentitySpecifier: string
  developerIdentitySpecifier: string
  deployerSaEmail: string
  imageUri: Record<string, Record<string, string>>
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

// Parse image URIs from GitHub Actions environment variables
// Format: CDKTF_IMAGE_URI_STACKID_SERVICEID
const imageUriEnvVars = Object.entries(process.env)
  .filter(([key]) => key.startsWith('CDKTF_IMAGE_URI_'))
  .reduce(
    (acc, [key, value]) => {
      if (!value) return acc
      // Parse: CDKTF_IMAGE_URI_JOBS_API -> { jobs: { api: "..." } }
      const parts = key.replace('CDKTF_IMAGE_URI_', '').toLowerCase().split('_')
      if (parts.length >= 2) {
        const [stackId, serviceId] = parts
        if (!acc[stackId]) acc[stackId] = {}
        acc[stackId][serviceId] = value
      }
      return acc
    },
    {} as Record<string, Record<string, string>>,
  )

export const envConfig: EnvConfig = {
  billingAccount: envVars.GCP_TOOLS_BILLING_ACCOUNT,
  bucket: envVars.GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID,
  ciEnvironments: envVars.GCP_TOOLS_CI_ENVIRONMENTS,
  environment: envVars.GCP_TOOLS_ENVIRONMENT,
  orgId: envVars.GCP_TOOLS_ORG_ID,
  owners: envVars.GCP_TOOLS_OWNER_EMAILS,
  projectName: envVars.GCP_TOOLS_PROJECT_NAME,
  regions: envVars.GCP_TOOLS_REGIONS,
  user: envVars.GCP_TOOLS_USER,
  foundationProjectId: envVars.GCP_TOOLS_FOUNDATION_PROJECT_ID,
  foundationProjectNumber: envVars.GCP_TOOLS_FOUNDATION_PROJECT_NUMBER,
  githubIdentitySpecifier: envVars.GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER,
  developerIdentitySpecifier: envVars.GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER,
  deployerSaEmail: envVars.GCP_TOOLS_SERVICE_ACCOUNT_EMAIL,
  imageUri: imageUriEnvVars,
}
