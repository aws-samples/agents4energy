
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

### Add new data source
You can add new data sources thorugh [Amazon Athena Federated Query](https://docs.aws.amazon.com/athena/latest/ug/connect-to-a-data-source.html)

Steps:
1. Configure a new Amazon Athena Federated Query Data Source
1. Tag the data source with key: "AgentsForEnergy" and value: "true"
1. Create a JSON object for each table in the data source. See an example below.
1. Upload the files to 

Example Table Definition:
```json
{
  "dataSource": "AwsDataCatalog",
  "database": "production_db_171",
  "tableName": "crawler_pricing",
  "tableDefinition": "\"date\"\tvarchar\n\"wti_price\"\tdouble\n\"brent_price\"\tdouble\n\"volume\"\tbigint"
}
```
