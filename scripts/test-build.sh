#!/bin/bash

# A script to test the Cloud Build API directly from a local machine,
# using the currently authenticated gcloud user.

# Exit immediately if a command exits with a non-zero status.
set -e
# Trace commands before they are executed.
set -x

# --- Configuration ---
# Ensure the project ID is set. Prompt if it's not.
if [ -z "${PROJECT_ID:-}" ]; then
  # You can replace this with a hardcoded value if you prefer.
  # Example: PROJECT_ID="liplan-dev-app-op0atr"
  read -p "Enter the GCP Project ID to test the build in: " PROJECT_ID
fi

if [ -z "${PROJECT_ID}" ]; then
  echo "Error: PROJECT_ID is not set. Exiting."
  exit 1
fi

echo "--- Running Local Cloud Build Test ---"
echo "Project ID: ${PROJECT_ID}"
echo "Authenticated user: $(gcloud auth list --filter=status:ACTIVE --format="value(account)")"
echo "--------------------------------------"

# Define a simple inline cloudbuild configuration using a temporary file.
CLOUDBUILD_CONFIG=$(mktemp)
# Make sure the temp file is cleaned up on exit.
trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT

cat > "$CLOUDBUILD_CONFIG" <<EOF
steps:
- name: 'ubuntu'
  args: ['echo', 'Hello from a local test build in project ${PROJECT_ID}!']
timeout: '60s'
EOF

echo "Submitting a simple test build..."

# Submit the build without any source code.
# The --quiet flag automatically answers 'yes' to any prompts.
gcloud builds submit --quiet --no-source --config="$CLOUDBUILD_CONFIG" --project="${PROJECT_ID}"

echo "--- Build submitted successfully! ---"
echo "Check the build logs in the GCP Console for project ${PROJECT_ID}."
