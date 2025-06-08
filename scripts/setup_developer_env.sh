#!/bin/bash

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error when substituting.
set -o pipefail # Return value of a pipeline is the value of the last command to exit with a non-zero status

echo "### Starting Developer Environment Setup Script ###"

# --- 0. Pre-flight Checks ---
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud command not found. Please install the Google Cloud SDK and ensure it's in your PATH."
    exit 1
fi

# --- 1. Define Constants and Helper Functions ---
echo "### Step 1: Defining constants and variables ###"

# --- Function to prompt for required input ---
prompt_required() {
    local prompt_text=$1
    local var_name=$2
    local user_input
    read -p "${prompt_text}: " user_input
    if [ -z "${user_input}" ]; then
        echo "Error: Input for '${prompt_text}' is required."
        exit 1
    fi
    eval "${var_name}='${user_input}'"
}

# --- Function to prompt for input with a default value ---
prompt_with_default() {
    local prompt_text=$1
    local var_name=$2
    local default_value=$3
    local user_input
    read -p "${prompt_text} [${default_value}]: " user_input
    eval "${var_name}='${user_input:-${default_value}}'"
}

# Determine script and project root directories
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
PROJECT_ROOT=$( cd -- "$(dirname -- "${SCRIPT_DIR}")" &> /dev/null && pwd )

# --- 2. Gather User Inputs ---
echo "### Step 2: Gathering Required Information ###"
prompt_required "Enter the GCP Project ID" GCP_TOOLS_PROJECT_ID
prompt_required "Enter the Foundation GCP Project ID" GCP_TOOLS_FOUNDATION_PROJECT_ID
prompt_required "Enter your GCP Organization ID" GCP_TOOLS_ORG_ID
prompt_required "Enter your GCP Billing Account ID" GCP_TOOLS_BILLING_ACCOUNT
prompt_required "Enter your company's developer identity specifier (e.g., your-domain.com)" GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER
prompt_required "Enter your company's GitHub identity specifier (e.g., your-org)" GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER
prompt_required "Enter a comma-separated list of owner emails" GCP_TOOLS_OWNER_EMAILS
prompt_required "Enter a comma-separated list of GCP regions (e.g., europe-west1,europe-west2)" GCP_TOOLS_REGIONS

# Validate and process regions
GCP_TOOLS_REGIONS=$(echo "$GCP_TOOLS_REGIONS" | tr -d '[:space:]')
IFS=',' read -ra REGION_ARRAY <<< "$GCP_TOOLS_REGIONS"
NUM_REGIONS=${#REGION_ARRAY[@]}

if [ "${NUM_REGIONS}" -eq 0 ] || [ -z "${REGION_ARRAY[0]}" ]; then
  echo "Error: At least one GCP region must be provided."
  exit 1
fi

if [ "${NUM_REGIONS}" -gt 3 ]; then
  echo "Error: A maximum of 3 regions can be specified."
  exit 1
fi

prompt_required "Enter your name/identifier" GCP_TOOLS_USER
prompt_with_default "Enter the local environment name" GCP_TOOLS_ENVIRONMENT "dev"

# --- 3. Derive Variables ---
echo "### Step 3: Deriving remaining variables ###"
GCP_TOOLS_FOUNDATION_PROJECT_NUMBER=$(gcloud projects describe "${GCP_TOOLS_FOUNDATION_PROJECT_ID}" --format="value(projectNumber)")
if [ -z "${GCP_TOOLS_FOUNDATION_PROJECT_NUMBER}" ]; then
  echo "Error: Could not retrieve Project Number for ${GCP_TOOLS_FOUNDATION_PROJECT_ID}."
  prompt_required "Enter the Foundation GCP Project Number" GCP_TOOLS_FOUNDATION_PROJECT_NUMBER
fi
echo "Found Project Number: ${GCP_TOOLS_FOUNDATION_PROJECT_NUMBER}"

SERVICE_ACCOUNT_NAME="${GCP_TOOLS_PROJECT_ID}-sa"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${GCP_TOOLS_FOUNDATION_PROJECT_ID}.iam.gserviceaccount.com"
GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID="${GCP_TOOLS_FOUNDATION_PROJECT_ID}-terraform-state"
DEV_POOL_ID="${GCP_TOOLS_PROJECT_ID}-dev-pool"
LOCAL_DEV_PROVIDER_ID="local-developer-provider"

# Find gcloud path. This is more robust than assuming a fixed path.
GCLOUD_PATH=$(command -v gcloud)
GCLOUD_SDK_PATH=$(dirname "$(dirname "${GCLOUD_PATH}")")
echo "Found Google Cloud SDK at: ${GCLOUD_SDK_PATH}"
echo "-----------------------------------------------------"

# --- 4. Generate .env file ---
echo "### Step 4: Generating .env file ###"
ENV_TEMPLATE_FILE="${PROJECT_ROOT}/templates/env.tpl"
ENV_OUTPUT_FILE="$(pwd)/.env"

if [ ! -f "${ENV_TEMPLATE_FILE}" ]; then
  echo "Error: env template file not found at ${ENV_TEMPLATE_FILE}"
  exit 1
fi

echo "Generating ${ENV_OUTPUT_FILE} from ${ENV_TEMPLATE_FILE}..."
TEMP_ENV_FILE=$(mktemp)
# Correcting the typo in GCP_TOOLS_ORG_ID on the fly
sed -e "s|<GCP_TOOLS_BILLING_ACCOUNT>|${GCP_TOOLS_BILLING_ACCOUNT}|g" \
    -e "s|<GCP_TOOLS_CI_ENVIRONMENTS>|dev,test,sbx,prod|g" \
    -e "s|<GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER>|${GCP_TOOLS_DEVELOPER_IDENTITY_SPECIFIER}|g" \
    -e "s|<GCP_TOOLS_ENVIRONMENT>|${GCP_TOOLS_ENVIRONMENT}|g" \
    -e "s|<GCP_TOOLS_FOUNDATION_PROJECT_ID>|${GCP_TOOLS_FOUNDATION_PROJECT_ID}|g" \
    -e "s|<GCP_TOOLS_FOUNDATION_PROJECT_NUMBER>|${GCP_TOOLS_FOUNDATION_PROJECT_NUMBER}|g" \
    -e "s|<GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER>|${GCP_TOOLS_GITHUB_IDENTITY_SPECIFIER}|g" \
    -e "s|<GCP_TOOLS_ORG_ID>|${GCP_TOOLS_ORG_ID}|g" \
    -e "s|<GCP_TOOLS_OWNER_EMAILS>|${GCP_TOOLS_OWNER_EMAILS}|g" \
    -e "s|<GCP_TOOLS_PROJECT_ID>|${GCP_TOOLS_PROJECT_ID}|g" \
    -e "s|<GCP_TOOLS_REGIONS>|${GCP_TOOLS_REGIONS}|g" \
    -e "s|<GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID>|${GCP_TOOLS_TERRAFORM_REMOTE_STATE_BUCKET_ID}|g" \
    -e "s|<GCP_TOOLS_USER>|${GCP_TOOLS_USER}|g" \
    "${ENV_TEMPLATE_FILE}" > "${TEMP_ENV_FILE}"
mv "${TEMP_ENV_FILE}" "${ENV_OUTPUT_FILE}"
echo "Successfully generated ${ENV_OUTPUT_FILE}"
echo "-----------------------------------------------------"

# --- 5. Generate Workload Identity Federation config file ---
echo "### Step 5: Generating Workload Identity Federation config file ###"
WIF_TEMPLATE_FILE="${PROJECT_ROOT}/templates/local-dev-wif.json.tpl"
WIF_OUTPUT_FILE="$(pwd)/local-dev-wif.json"

if [ ! -f "${WIF_TEMPLATE_FILE}" ]; then
  echo "Error: WIF template file not found at ${WIF_TEMPLATE_FILE}"
  exit 1
fi

echo "Generating ${WIF_OUTPUT_FILE} from ${WIF_TEMPLATE_FILE}..."
TEMP_WIF_FILE=$(mktemp)
# Using '|' as a sed delimiter for paths
sed -e "s|<GCP_TOOLS_FOUNDATION_PROJECT_NUMBER>|${GCP_TOOLS_FOUNDATION_PROJECT_NUMBER}|g" \
    -e "s|<POOL_ID>|${DEV_POOL_ID}|g" \
    -e "s|<PROVIDER_ID>|${LOCAL_DEV_PROVIDER_ID}|g" \
    -e "s|<PATH_TO_GOOGLE_CLOUD_SDK>|${GCLOUD_SDK_PATH}|g" \
    -e "s|<TARGET_SERVICE_ACCOUNT_EMAIL>|${SERVICE_ACCOUNT_EMAIL}|g" \
    "${WIF_TEMPLATE_FILE}" > "${TEMP_WIF_FILE}"
mv "${TEMP_WIF_FILE}" "${WIF_OUTPUT_FILE}"
echo "Successfully generated ${WIF_OUTPUT_FILE}"
echo "-----------------------------------------------------"

echo "### Developer Environment Setup Completed Successfully! ###"
echo "Created ${WIF_OUTPUT_FILE} and ${ENV_OUTPUT_FILE}."
echo
echo "To activate the environment, you must first source the .env file:"
echo "source \"${ENV_OUTPUT_FILE}\""
echo
echo "Then, set the GOOGLE_APPLICATION_CREDENTIALS environment variable:"
echo "export GOOGLE_APPLICATION_CREDENTIALS=\"${WIF_OUTPUT_FILE}\""
echo
echo "You can now authenticate with gcloud using Workload Identity Federation."
echo "For example: gcloud projects describe \${GCP_TOOLS_FOUNDATION_PROJECT_NUMBER}"
echo
