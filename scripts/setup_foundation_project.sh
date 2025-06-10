#!/bin/bash

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error when substituting.
set -o pipefail # Return value of a pipeline is the value of the last command to exit with a non-zero status

echo "### Starting GCP Project and Infrastructure Setup Script ###"

# --- 0. Configuration and Environment Variable Checks ---
echo "### Step 0: Validating Environment Variables ###"
# Prompt for environment variables if they are not set.
# The `:-""` is used to avoid issues with `set -u` (treat unset variables as an error).

if [ -z "${GCP_TOOLS_PROJECT_ID:-}" ]; then
  read -p "Enter your GCP PROJECT ID (eg., 'platform' | 'web-app'): " GCP_TOOLS_PROJECT_ID
fi


if [ -z "${GCP_TOOLS_ORG_ID:-}" ]; then
  read -p "Enter your GCP Organization ID: " GCP_TOOLS_ORG_ID
fi

if [ -z "${GCP_TOOLS_BILLING_ACCOUNT:-}" ]; then
  read -p "Enter your GCP Billing Account ID: " GCP_TOOLS_BILLING_ACCOUNT
fi

if [ -z "${GCP_DEFAULT_REGION:-}" ]; then
  read -p "Enter the default GCP region (e.g., europe-west1): " GCP_DEFAULT_REGION
fi

if [ -z "${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER:-}" ]; then
  read -p "Enter your GitHub identity specifier (e.g., 'your-org' or 'owner/repo'): " GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER
fi

if [ -z "${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER:-}" ]; then
  read -p "Enter your Developer identity specifier (e.g., 'your-email@domain.com' or 'domain.com'): " GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER
fi

# Final check to ensure variables are now set.
if [ -z "${GCP_TOOLS_PROJECT_ID}" ]; then echo "Error: GCP_TOOLS_PROJECT_ID is not set."; exit 1; fi
if [ -z "${GCP_TOOLS_ORG_ID}" ]; then echo "Error: GCP_TOOLS_ORG_ID is not set."; exit 1; fi
if [ -z "${GCP_TOOLS_BILLING_ACCOUNT}" ]; then echo "Error: GCP_TOOLS_BILLING_ACCOUNT is not set."; exit 1; fi
if [ -z "${GCP_DEFAULT_REGION}" ]; then echo "Error: GCP_DEFAULT_REGION is not set."; exit 1; fi
if [ -z "${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}" ]; then echo "Error: GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER is not set."; exit 1; fi
if [ -z "${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}" ]; then echo "Error: GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER is not set."; exit 1; fi

PROJECT_ID_BASE="${GCP_TOOLS_PROJECT_ID}-foundation"
# Generate a unique project ID using a timestamp
PROJECT_ID="${PROJECT_ID_BASE}-$(date +%s)"
SERVICE_ACCOUNT_NAME="${GCP_TOOLS_PROJECT_ID}-sa"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

DEV_POOL_ID="${GCP_TOOLS_PROJECT_ID}-dev-pool"
TEST_POOL_ID="${GCP_TOOLS_PROJECT_ID}-test-pool"
SBX_POOL_ID="${GCP_TOOLS_PROJECT_ID}-sbx-pool"
PROD_POOL_ID="${GCP_TOOLS_PROJECT_ID}-prod-pool"

GITHUB_PROVIDER_ID="github-actions-provider"
LOCAL_DEV_PROVIDER_ID="local-developer-provider"

echo "Generated Project ID: ${PROJECT_ID}"
echo "Service Account Email: ${SERVICE_ACCOUNT_EMAIL}"
echo "Default Region: ${GCP_DEFAULT_REGION}"
echo "GitHub Identity Specifier: ${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}"
echo "Developer Identity Specifier: ${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}"
echo "-----------------------------------------------------"

# --- 1. Create New GCP Project ---
echo "### Step 1: Creating new GCP Project: ${PROJECT_ID} ###"
gcloud projects create "${PROJECT_ID}" \
  --name="${PROJECT_ID_BASE}" \
  --organization="${GCP_TOOLS_ORG_ID}" \
  --set-as-default

echo "### Linking project to Billing Account: ${GCP_TOOLS_BILLING_ACCOUNT} ###"
gcloud billing projects link "${PROJECT_ID}" \
  --billing-account="${GCP_TOOLS_BILLING_ACCOUNT}"

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
echo "Project Number for ${PROJECT_ID} is ${PROJECT_NUMBER}"
echo "-----------------------------------------------------"

# --- 2. Enable APIs ---
echo "### Step 2: Enabling APIs on project ${PROJECT_ID} ###"
APIS_TO_ENABLE=(
  "cloudresourcemanager.googleapis.com"
  "cloudbilling.googleapis.com"
  "iam.googleapis.com"
  "compute.googleapis.com"
  "sts.googleapis.com" # Security Token Service API (for WIF)
  "iamcredentials.googleapis.com" # For SA impersonation
)
for API in "${APIS_TO_ENABLE[@]}"; do
  echo "Enabling ${API}..."
  gcloud services enable "${API}" --project="${PROJECT_ID}"
done
echo "-----------------------------------------------------"

# --- 3. Create Service Account ---
echo "### Step 3: Creating Service Account: ${SERVICE_ACCOUNT_NAME} ###"
gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
  --project="${PROJECT_ID}" \
  --display-name="${SERVICE_ACCOUNT_NAME}"
echo "-----------------------------------------------------"

# --- 4. Assign IAM Roles to Service Account ---
echo "### Step 4a: Assigning Project-Level IAM Roles to ${SERVICE_ACCOUNT_EMAIL} ###"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/viewer"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.admin"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/iam.serviceAccountAdmin"

echo "### Step 4b: Assigning Organization-Level IAM Roles to ${SERVICE_ACCOUNT_EMAIL} ###"
echo "Assigning roles/resourcemanager.projectCreator on Organization ${GCP_TOOLS_ORG_ID}"
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/resourcemanager.projectCreator"
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/resourcemanager.projectDeleter"
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/iam.serviceAccountAdmin"
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/serviceusage.serviceUsageAdmin"
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/resourcemanager.projectIamAdmin"
# Grants permission to create and manage VPC networks
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/compute.networkAdmin"
# Grants permission to create and manage Serverless VPC Access Connectors
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/vpcaccess.admin"
# Grants permission to enable Shared VPC hosting
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/compute.xpnAdmin"
# Grants permission to manage Secret Manager secrets
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.admin"
# Grants permission to manage Cloud SQL instances
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudsql.admin"
# Grants permission to manage Pub/Sub topics and subscriptions
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/pubsub.admin"
# Grants permission to manage Cloud Run services
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/run.admin"
# Grants permission to manage Cloud Functions
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudfunctions.admin"
# Grants permission to manage API Gateway services
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/apigateway.admin"
# Grants permission to manage Spanner instances
gcloud organizations add-iam-policy-binding "${GCP_TOOLS_ORG_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/spanner.admin"

echo "Assigning roles/billing.user on Billing Account ${GCP_TOOLS_BILLING_ACCOUNT}"
gcloud billing accounts add-iam-policy-binding "${GCP_TOOLS_BILLING_ACCOUNT}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/billing.user"

echo "-----------------------------------------------------"

# --- 5. Create Workload Identity Pools & Providers ---
echo "### Step 5: Creating Workload Identity Pools and Providers ###"

# GitHub Identity Configuration
GITHUB_ATTRIBUTE_CONDITION=""
GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART=""
if [[ "${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}" == *"/"* ]]; then
  # It's a repo: owner/repo
  GITHUB_ATTRIBUTE_CONDITION="assertion.repository == '${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}'"
  GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART="attribute.repository/${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}"
else
  # It's an org
  GITHUB_ATTRIBUTE_CONDITION="assertion.repository_owner == '${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}'"
  GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART="attribute.repository_owner/${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}"
fi

# Developer Identity Configuration
DEVELOPER_ATTRIBUTE_CONDITION=""
DEVELOPER_IAM_PRINCIPAL_ATTRIBUTE_PART=""
DEV_PROVIDER_ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.email=assertion.email"
if [[ "${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}" == *"@"* ]]; then
  # It's an email
  DEVELOPER_ATTRIBUTE_CONDITION="assertion.email == '${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}'"
  DEVELOPER_IAM_PRINCIPAL_ATTRIBUTE_PART="attribute.email/${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}"
else
  # It's a domain
  DEVELOPER_ATTRIBUTE_CONDITION="assertion.email.endsWith('@${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}')"
  # Map a custom attribute `is_developer` to `true` if the email matches the domain.
  DEV_PROVIDER_ATTRIBUTE_MAPPING+=",attribute.is_developer=assertion.email.endsWith('@${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}')"
  # The IAM binding will now target this new attribute.
  DEVELOPER_IAM_PRINCIPAL_ATTRIBUTE_PART="attribute.is_developer/true"
fi


create_github_provider() {
  local pool_id=$1
  local pool_display_name_suffix=$2

  echo "Creating Pool: ${pool_id}"
  gcloud iam workload-identity-pools create "${pool_id}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --display-name="${GCP_TOOLS_PROJECT_ID}-${pool_display_name_suffix}-pool" \
    --description="Pool for ${GCP_TOOLS_PROJECT_ID}-${pool_display_name_suffix} environment"

  echo "Creating GitHub Provider for Pool: ${pool_id}"
  gcloud iam workload-identity-pools providers create-oidc "${GITHUB_PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --workload-identity-pool="${pool_id}" \
    --location="global" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --allowed-audiences="https://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${pool_id}/providers/${GITHUB_PROVIDER_ID}" \
    --display-name="GitHub Actions Provider" \
    --description="Provider for GitHub Actions" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="${GITHUB_ATTRIBUTE_CONDITION}"
}

# Create Dev Pool & Providers
create_github_provider "${DEV_POOL_ID}" "dev"
echo "Creating Local Developer Provider for Pool: ${DEV_POOL_ID}"
gcloud iam workload-identity-pools providers create-oidc "${LOCAL_DEV_PROVIDER_ID}" \
  --project="${PROJECT_ID}" \
  --workload-identity-pool="${DEV_POOL_ID}" \
  --location="global" \
  --issuer-uri="https://accounts.google.com" \
  --allowed-audiences="https://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${DEV_POOL_ID}/providers/${LOCAL_DEV_PROVIDER_ID}" \
  --display-name="Local Developer Provider" \
  --description="Provider for Local Developers" \
  --attribute-mapping="${DEV_PROVIDER_ATTRIBUTE_MAPPING}" \
  --attribute-condition="${DEVELOPER_ATTRIBUTE_CONDITION}"

# Create Test Pool & Provider
create_github_provider "${TEST_POOL_ID}" "test"

# Create Sbx Pool & Provider
create_github_provider "${SBX_POOL_ID}" "sbx"

# Create Prod Pool & Provider
create_github_provider "${PROD_POOL_ID}" "prod"
echo "-----------------------------------------------------"

# --- 6. Grant Impersonation Rights ---
echo "### Step 6: Granting Impersonation Rights to ${SERVICE_ACCOUNT_EMAIL} ###"

grant_impersonation() {
  local pool_id=$1
  local principal_set_attribute_part=$2

  # A principalSet targets a group of identities based on an attribute.
  local principal="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${pool_id}/${principal_set_attribute_part}"

  echo "Allowing ${principal} to impersonate ${SERVICE_ACCOUNT_EMAIL}"
  gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT_EMAIL}" \
    --project="${PROJECT_ID}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="${principal}"
}

# Grant for GitHub providers in all pools
grant_impersonation "${DEV_POOL_ID}" "${GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART}"
grant_impersonation "${TEST_POOL_ID}" "${GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART}"
grant_impersonation "${SBX_POOL_ID}" "${GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART}"
grant_impersonation "${PROD_POOL_ID}" "${GITHUB_IAM_PRINCIPAL_ATTRIBUTE_PART}"

# Grant for Local Developer provider in Dev pool
grant_impersonation "${DEV_POOL_ID}" "${DEVELOPER_IAM_PRINCIPAL_ATTRIBUTE_PART}"

echo "-----------------------------------------------------"

# --- 7. Create GCS Bucket ---
# Note: Bucket names are globally unique. This might fail if the name is taken.
# Consider appending ${PROJECT_ID} to BUCKET_NAME_REQUESTED for uniqueness.
BUCKET_FULL_NAME="gs://${PROJECT_ID}-terraform-state" # Using requested name

echo "### Step 7: Creating GCS Bucket: ${BUCKET_FULL_NAME} in ${GCP_DEFAULT_REGION} ###"
# This command uses the gcloud identity of the script executor.
# The identity needs 'Storage Admin' role on the project to create a bucket.
# The service account created earlier has this role, but this step runs as the
# initial user/principal executing the script.
gcloud storage buckets create "${BUCKET_FULL_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${GCP_DEFAULT_REGION}"
echo "-----------------------------------------------------"

echo "### GCP Project and Infrastructure Setup Script Completed Successfully! ###"
echo "Project ID: ${PROJECT_ID}"
echo "Service Account: ${SERVICE_ACCOUNT_EMAIL}"
echo "Review all created resources and IAM policies in the GCP console."
