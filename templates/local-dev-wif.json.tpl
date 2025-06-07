{
  "type": "external_account",
  "audience": "//iam.googleapis.com/projects/<GCP_TOOLS_FOUNDATION_PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
  "token_url": "https://sts.googleapis.com/v1/token",
  "credential_source": {
    "executable": {
      "command": "<PATH_TO_GOOGLE_CLOUD_SDK>/bin/gcloud auth print-identity-token --audiences=\"//iam.googleapis.com/projects/<GCP_TOOLS_FOUNDATION_PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>\" --include-email",
      "timeout_millis": 5000,
      "output_file": null
    }
  },
  "service_account_impersonation_url": "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<TARGET_SERVICE_ACCOUNT_EMAIL>:generateAccessToken"
}