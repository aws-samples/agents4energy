
# Agents4Energy Deployent Steps
1. Fork the Agents4Energy GitHub repository
2. Login to your AWS account navigate to Model Access in Amazon Bedrock
![Enable Bedrock Models](assets/images/AFE-Deploy01.png)
3. Enable the desired foundation models for use with your agentic workflows
4. Access should be granted immediately
5. Test the models in the Chat/Text playground of your desired region
6. Navigate to AWS Amplify and click Deploy an app




## Develop
To begin developing in this repo, perform the following steps. These steps are indepent of the deployment steps.
1. Clone the repo
1. Run `npm install` to install the required packages.
1. Run `npm run ecrAuth` to authenticate with the AWS ECR repo. This lets you pull lambda build images.
1. Run `npx ampx sandbox` to create your personal standbox enviroment for development.
1. In a different ternimal run `npm run dev` to start a develpment server for the front end. You can reach this server by navigating to `localhost:3000` in an internet browser.
1. Now when you make code changes, they will be deployed to both the front and back end.


### Limit sign up to certain email addresses
When a user signs up for an account, the suffix of their email address is checked against an allow list.
To change which email address suffixes are allowed, follow these steps:
1. In the AWS amplify console, navigate to your branch.
1. Click the "Functions" button on the left side bar
1. Look for the funciton with "preSignUp" in the function name. Click on this function.
1. Click "View in Lambda"
1. Click "Configuration" and then "Environmental Variables"
1. The variable named "ALLOWED_EMAIL_SUFFIXES" is a comma seperated list of allowed email suffixes. Change this variable to reflect the email addresses you would like to allow. If you add an empty element (ex: `@amazon.com,`), any email address will be allowed. 

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
2. Tag the data source with key: "AgentsForEnergy" and value: "true"
3. Create a JSON object for each table in the data source. See an example below.
4. Upload the files  

Example Table Definition:
```json
{
  "dataSource": "AwsDataCatalog",
  "database": "production_db_171",
  "tableName": "crawler_pricing",
  "tableDefinition": "\"date\"\tvarchar\n\"wti_price\"\tdouble\n\"brent_price\"\tdouble\n\"volume\"\tbigint"
}
```

## Maintenance Agent