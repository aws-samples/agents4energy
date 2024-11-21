
## Deployent Steps
1. Fork the repo
1. Configure the AWS Amplify to deploy the repo
    1. Use this build image: aws/codebuild/amazonlinux2-x86_64-standard:5.0


## Production Agent

### Add new structured data
This data will be queried using AWS Athena
Steps:
1. Upload your data to the key `production-agent/additional-data/` in the file drive
1. Run the glue crawler
1. Either, trigger the recordTableDefAndStartKBIngestion lambda function, or wait 15 minutes and the lambda function will trigger automatically
1. Now you can ask the prodution agent questions about the new data!

