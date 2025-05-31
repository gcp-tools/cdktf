### gcp-tools/cdktf 

Painless deployment of GCP infrastructure with Terraform CDK




Projects CDKTF App
  (It's stacks are isolated)

  HostProjectStack
  DataProjectStack
  AppProjectStack


Infra
  (It's stacks can request terraform state from the stacks in Projects, and each other)

  NetworkInfraStack (depends on HostProjectStack, DataProjectStack, AppProjectStack)
  IamInfraStack (depends on AppProjectStack, NetworkInfraStack)
  SqlInfraStack (depends on HostProjectStack, DataProjectStack, NetworkInfraStack)
  FirestoreInfraStack (AppProjectStack)

App 
  (The Base App stack that all the services extend from gets state from the infra Stacks and the AppProjectStack)
  
  Services stacks

