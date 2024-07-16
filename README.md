@gcp/cdktf library

@gcp/cdktf/stacks/projects

    HostProject
    DbProject
    AppProject


@gcp/cdktf/stacks/infrastucture

    NetworkStack
    SqlStack
    IamStack

@gcp/cdktf/stacks/application

    ApplicationBaseStack

@gcp/cdktf/constructs
    
    Firestore
    Queue
    Topic
    WorkloadIdentity

    CloudRun
    CloudFunction.CloudEvent
    CloudFunction.FireStore
    CloudFunction.Http
    CloudFunction.Subscription
    CloudFunction.Scheduler







potential stacks
workspaces

    projects
        host-stack.mts
        db-stack.mts
        app-stack.mts
        base-project-stack.mts
    infra
        network-stack.mts
        sql-stack.mts
        bigquery-stack.mts

    application
        base-application-stack.mts

    base.mts



id ()
if (this.stackType !== 'app') {
  return `${environment}-${this.stackType}-${this.stackId}`
} 
if (user === 'ci') {
  return `${environment}-${this.stackType}-${this.stackId}`
}
return `${user}-${this.stackType}-${this.stackId}`


naming convention

{env}-{project-type}-{name}

projects

    {dev|qa|prod}-project-host
    {dev|qa|prod}-project-db
    {dev|qa|prod}-project-app

infra

    {dev|qa|prod}-infra-network
    {dev|qa|prod}-infra-sql
    {dev|qa|prod}-infra-iam

app

    deploy app stacks into

        dev-project-app

            si-app-firestore
            si-app-topics
            si-app-queues
            si-app-services
            si-app-ui
            
            mr01-app-firestore
            mr01-app-topics
            mr01-app-queues
            mr01-app-services
            mr01-app-ui

            dev-app-firestore
            dev-app-topics
            dev-app-queues
            dev-app-services
            dev-app-ui

        qa-project-app

            qa-app-firestore
            qa-app-topics
            qa-app-queues
            qa-app-services
            qa-app-ui

        prod-project-app

            prod-app-firestore
            prod-app-topics
            prod-app-queues
            prod-app-services
            prod-app-ui
