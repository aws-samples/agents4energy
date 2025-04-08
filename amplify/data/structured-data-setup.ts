import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { IFunction } from '@aws-amplify/backend-function';

export interface StructuredDataSetupProps {
  bucket: s3.IBucket;
}

export class StructuredDataSetup extends Construct {
  public readonly glueDatabase: glue.CfnDatabase;
  public readonly glueCrawler: glue.CfnCrawler;
  public readonly athenaWorkgroup: athena.CfnWorkGroup;
  public readonly triggerCrawlerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: StructuredDataSetupProps) {
    super(scope, id);

    // Define all agent types
    const agentTypes = [
      'production',
      'regulatory',
      'drilling',
      'petrophysics',
      'finance',
      'land',
      'refining',
      'trading',
      'logistics',
      'decarb'
    ];

    // Create a Glue role with necessary permissions
    const glueRole = new iam.Role(this, 'GlueRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ]
    });

    // Grant S3 permissions to the Glue role
    props.bucket.grantRead(glueRole);

    // Create targets for all agent directories
    const s3Targets = agentTypes.map(agentType => ({
      path: `s3://${props.bucket.bucketName}/${agentType}-agent/structured-data-files/`
    }));

    // Create the Glue database
    this.glueDatabase = new glue.CfnDatabase(this, 'AgentsDatabase', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseInput: {
        name: 'agents4energy_db',
        description: 'Database for Agents4Energy structured data'
      }
    });

    // Create the Glue crawler
    this.glueCrawler = new glue.CfnCrawler(this, 'AgentsCrawler', {
      name: 'agents4energy-crawler',
      role: glueRole.roleArn,
      databaseName: this.glueDatabase.ref,
      schedule: {
        scheduleExpression: 'cron(0/5 * * * ? *)'  // Run every 5 minutes
      },
      targets: {
        s3Targets: s3Targets
      },
      configuration: JSON.stringify({
        Version: 1.0,
        Grouping: {
          TableGroupingPolicy: 'CombineCompatibleSchemas'
        }
      })
    });

    // Configure Athena workgroup
    this.athenaWorkgroup = new athena.CfnWorkGroup(this, 'AgentsWorkgroup', {
      name: 'agents4energy-workgroup',
      description: 'Workgroup for Agents4Energy queries',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${props.bucket.bucketName}/athena-results/`
        },
        publishCloudWatchMetricsEnabled: true,
        enforceWorkGroupConfiguration: true
      }
    });

    // Create a Lambda function to trigger the Glue crawler after deployment
    this.triggerCrawlerFunction = new lambda.Function(this, 'TriggerCrawlerFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const glue = new AWS.Glue();
        
        exports.handler = async (event) => {
          console.log('Starting Glue crawler');
          
          try {
            await glue.startCrawler({ Name: 'agents4energy-crawler' }).promise();
            return { statusCode: 200, body: 'Crawler started successfully' };
          } catch (error) {
            console.error('Error starting crawler:', error);
            return { statusCode: 500, body: 'Error starting crawler' };
          }
        };
      `),
      timeout: cdk.Duration.minutes(5)
    });

    // Grant permission to start the crawler
    this.triggerCrawlerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:StartCrawler'],
      resources: ['*']
    }));

    // Create a custom resource to trigger the crawler after deployment
    const triggerCrawlerProvider = new cr.Provider(this, 'TriggerCrawlerProvider', {
      onEventHandler: this.triggerCrawlerFunction
    });

    const triggerCrawlerResource = new cdk.CustomResource(this, 'TriggerCrawlerResource', {
      serviceToken: triggerCrawlerProvider.serviceToken,
      properties: {
        CrawlerName: 'agents4energy-crawler',
        Timestamp: Date.now() // Force execution on each deployment
      }
    });

    // Ensure the custom resource runs after the crawler is created
    triggerCrawlerResource.node.addDependency(this.glueCrawler);
  }

  // Method to add permissions for an agent Lambda function
  public addPermissionsToAgentFunction(agentFunction: lambda.Function): void {
    // Grant Athena permissions
    agentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution'
      ],
      resources: ['*']
    }));
    
    // Grant Glue permissions
    agentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'glue:GetDatabase',
        'glue:GetDatabases',
        'glue:GetTable',
        'glue:GetTables',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:BatchGetPartition'
      ],
      resources: ['*']
    }));
  }
}
