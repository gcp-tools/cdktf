# gcp-tools/cdktf

Reusable CDKTF Stack and Construct Patterns for GCP Applications

## Note

While you can use this library as is, it has been designed to be used with [gcp-tools-core](https://github.com/gcp-tools/core); an AI-enabled platform to scaffold, build and deploy robust GCP applications.


## Overview

**gcp-tools-cdktf** is a TypeScript library providing a comprehensive set of [Cloud Development Kit for Terraform (CDKTF)](https://developer.hashicorp.com/terraform/cdktf) stack and construct patterns for Google Cloud Platform (GCP). It enables you to rapidly compose, configure, and deploy production-grade GCP infrastructure as code.

## What's Included

- **Stacks** (`src/stacks/`):
  - **Infrastructure Stacks**: VPC networking, IAM, Cloud SQL, Firestore (with
    optional composite indexes), and UI hosting.
  - **Project Stacks**: Patterns for host, data, and app project separation.
  - **App Stacks**: Application-level service composition.
  - **Ingress Stacks**: Patterns for API gateways and load balancers.
  - **Base Stacks**: Extendable base classes for custom stacks.

- **Constructs** (`src/constructs/`):
  - **Cloud Run**: Easily deploy and manage Cloud Run services.
  - **Cloud Functions**: HTTP, CloudEvent, and scheduled functions, plus Pub/Sub subscriptions.
  - **API Gateway**: Securely expose APIs for your services.
  - **Load Balancer**: L7 load balancer for web and API traffic.
  - **Pub/Sub Topics**: Event-driven messaging constructs.
  - **Base Constructs**: Foundation for building custom application and ingress resources.

- **Utilities** (`src/utils/`):
  - **Environment Management**: Centralized environment and region configuration.

## Key Features

- **Composable**: Mix and match constructs and stacks to fit your application's needs.
- **Best Practices**: Enforces GCP security, networking, and project organization standards.
- **Least-Privilege IAM**: Patterns and constructs for least-permission service account scoping and secure role assignment.
- **Strict TypeScript**: All constructs and stacks are fully typed for safety and IDE support.
- **Production-Ready**: Designed for real-world, multi-environment GCP deployments.

## Example Project Structure

```plaintext
iac/
├── projects/   # Project management stacks (host, data, app projects)
├── infra/      # Core infrastructure (networking, IAM, databases, etc.)
├── app/        # Application-level services and stacks
├── ingress/    # Load balancers, API gateways, and ingress resources
```

## Example Usage

For a full example project structure, see [gcp-tools-example-app](https://github.com/gcp-tools/example-app).

```typescript
import { cloudrun } from '@gcp-tools/cdktf/constructs'
import { AppStack } from '@gcp-tools/cdktf/stacks/app'
import { envConfig } from '@gcp-tools/cdktf/utils'
import { type App, TerraformOutput } from 'cdktf'

export class JobsStack extends AppStack {
  public readonly apiService: cloudrun.CloudRunServiceConstruct

  constructor(scope: App) {
    super(scope, 'jobs', {
      databases: ['firestore'],
    })

    this.apiService = new cloudrun.CloudRunServiceConstruct(
      this,
      'api',
      {
        region: envConfig.regions[0],
        buildConfig: {},
        serviceConfig: {
          environmentVariables: {
            FIRESTORE_PROJECT_ID: this.firestoreDatabaseProjectId,
            NODE_ENV: 'production',
          },
        },
      },
    )
  }
}
```

### Firestore Infra Stack with Composite Indexes

```typescript
import { FirestoreInfraStack } from '@gcp-tools/cdktf/stacks/infrastructure'
import { App } from 'cdktf'

const app = new App()

new FirestoreInfraStack(app, {
  indexes: [
    {
      id: 'users-by-tenant-email',
      collection: 'users',
      fields: [
        { fieldPath: 'tenantId', order: 'ASCENDING' },
        { fieldPath: 'email', order: 'ASCENDING' },
      ],
    },
  ],
})
```
