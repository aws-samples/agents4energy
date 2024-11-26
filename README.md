
## Deployent Steps
1. Fork the repo
1. Configure the AWS Amplify to deploy the repo
    1. Use this build image: aws/codebuild/amazonlinux2-x86_64-standard:5.0
    1. Set the maximum build time to 1 hour


## Production Agent

### Add new structured data
This data will be queried using AWS Athena
Steps:
1. Upload your data to the key `production-agent/structured-data-files/` in the file drive
1. Wait 5 minutes for the AWS Glue craweler to run, and for the new table definitions to be loaded into the Amazon Bedrock Knowledge Base.
1. Now you can ask the prodution agent questions about the new data!

