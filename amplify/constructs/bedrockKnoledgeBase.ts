import * as cdk from 'aws-cdk-lib';
import {
  aws_s3 as s3,
  aws_ec2 as ec2,
  aws_bedrock as bedrock,
  aws_rds as rds,
  aws_iam as iam,
  custom_resources as cr
} from 'aws-cdk-lib';
// import * as lambda from 'aws-cdk-lib/aws-lambda';
// import { bedrock as cdkLabsBedrock } from "@cdklabs/generative-ai-cdk-constructs";
import { Construct } from 'constructs';

export interface KnowledgeBaseProps {
  vpc: ec2.Vpc;
  bucket: s3.IBucket;
}

const defaultDatabaseName = 'bedrock_vector_db'
const schemaName = 'bedrock_integration'
const tableName = 'bedrock_kb'
const primaryKeyField = 'id'
const vectorField = 'embedding'
const textField = 'chunks'
const metadataField = 'metadata'
const vectorDimensions = 1024

const ExecuteSQLStatementRescource = (scope: Construct, id: string, props: {
  vectorStorePostgresCluster: rds.DatabaseCluster | rds.ServerlessCluster,
  sql_command: string
}) => (
  new cr.AwsCustomResource(scope, id, {
    onCreate: {
      service: 'RDSDataService',
      action: 'executeStatement',
      parameters: {
        resourceArn: props.vectorStorePostgresCluster.clusterArn,
        database: defaultDatabaseName,
        sql: props.sql_command,
        secretArn: props.vectorStorePostgresCluster.secret!.secretArn,
      },
      physicalResourceId: cr.PhysicalResourceId.of(id),
    },
    policy: cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: [
          'rds-data:ExecuteStatement',
        ],
        resources: [props.vectorStorePostgresCluster.clusterArn],
      }),
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [props.vectorStorePostgresCluster.secret!.secretArn],
      }),
    ]),
  }))

export class AuroraBedrockKnoledgeBase extends Construct {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly embeddingModelArn: string

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/cohere.embed-multilingual-v3`

    // const vectorStorePostgresCluster = new rds.DatabaseCluster(scope, 'VectorStoreAuroraCluster-1', {
    //   engine: rds.DatabaseClusterEngine.auroraPostgres({
    //     version: rds.AuroraPostgresEngineVersion.VER_16_4,
    //   }),
    //   enableDataApi: true,
    //   defaultDatabaseName: defaultDatabaseName,
    //   writer: rds.ClusterInstance.serverlessV2('writer'),
    //   serverlessV2MinCapacity: 0.5,
    //   serverlessV2MaxCapacity: 2,
    //   vpcSubnets: {
    //     subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    //   },
    //   vpc: props.vpc,
    //   port: 2000,
    //   // backtrackWindow: cdk.Duration.hours(1),
    //   removalPolicy: cdk.RemovalPolicy.DESTROY
    // });

    const vectorStorePostgresCluster = new rds.ServerlessCluster(this, 'VectorStoreAuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_13_9,
      }),
      scaling: {
        autoPause: cdk.Duration.minutes(300),
        minCapacity: rds.AuroraCapacityUnit.ACU_2, // minimum of 2 Aurora capacity units
        maxCapacity: rds.AuroraCapacityUnit.ACU_16, // maximum of 16 Aurora capacity units
      },
      defaultDatabaseName: defaultDatabaseName,
      enableDataApi: true,
      // credentials: rds.Credentials.fromGeneratedSecret('clusteradmin', { // TODO: make a prefix for all a4e secrets
      //     secretName: `${rootStack.stackName}-proddb-credentials`
      // }),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // https://github.com/awslabs/generative-ai-cdk-constructs/blob/main/lambda/amazon-aurora-pgvector-custom-resources/custom_resources/amazon_aurora_pgvector.py

    const sqlStatements = [
         /* sql */`
      CREATE EXTENSION IF NOT EXISTS vector;
      `, /* sql */`
      CREATE SCHEMA ${schemaName};
      `, /* sql */`
      CREATE TABLE ${schemaName}.${tableName} (
        ${primaryKeyField} uuid PRIMARY KEY,
        ${vectorField} vector(${vectorDimensions}),
        ${textField} text, 
        ${metadataField} json
      );
      `, /* sql */`
      CREATE INDEX on ${schemaName}.${tableName}
      USING hnsw (${vectorField} vector_cosine_ops);
      `
    ]

    const runSQLStatements = ExecuteSQLStatementRescource(this, 'createPGExtenstion', {
      vectorStorePostgresCluster: vectorStorePostgresCluster,
      sql_command: sqlStatements.join('\n\n')
    })

    // // Custom Resource to run SQL statements
    // const sqlStatements = `
    //   CREATE TABLE IF NOT EXISTS my_table (
    //     id SERIAL PRIMARY KEY,
    //     name VARCHAR(100) NOT NULL
    //   );
    //   INSERT INTO my_table (name) VALUES ('example1'), ('example2');
    // `;

    // const sqlLambdaFunction = new cdk.aws_lambda.Function(this, 'SqlLambda', {
    //   runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
    //   handler: 'index.handler',
    //   code: cdk.aws_lambda.Code.fromInline(`
    //     const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');

    //     const rdsDataClient = new RDSDataClient();

    //     exports.handler = async (event) => {
    //       const dbClusterArn = "${vectorStorePostgresCluster.clusterArn}";
    //       const secretArn = "${vectorStorePostgresCluster.secret!.secretArn}";
    //       const sqlStatements = JSON.parse(${JSON.stringify(sqlStatements)});
    //       const results = [];

    //       // Loop through SQL statements and execute them
    //       for (const sql of sqlStatements) {
    //         try {
    //           const params = {
    //             resourceArn: dbClusterArn,
    //             secretArn: secretArn,
    //             sql: sql,
    //             database: '${defaultDatabaseName}',
    //           };
            
    //           const command = new ExecuteStatementCommand(params);
    //           const result = await rdsDataClient.send(command);
              
    //           console.log('SQL execution result:', result);
    //           results.push(result);
    //         } catch (error) {
    //           console.error('SQL execution error:', error);
    //           throw error;
    //         }
    //       }

    //       return { statusCode: 200, body: JSON.stringify(results) };
    //     };
    //   `),
    // })

    // sqlLambdaFunction.addToRolePolicy(new iam.PolicyStatement({
    //   actions: [
    //     'rds-data:ExecuteStatement',
    //   ],
    //   resources: [vectorStorePostgresCluster.clusterArn],
    // }))

    // sqlLambdaFunction.addToRolePolicy(new iam.PolicyStatement({
    //   actions: ['secretsmanager:GetSecretValue'],
    //   resources: [vectorStorePostgresCluster.secret!.secretArn],
    // }
    // ))

    // // Lambda function to execute SQL
    // const sqlLambdaProvider = new cr.Provider(this, 'SqlLambdaProvider', {
    //   onEventHandler: sqlLambdaFunction
    // });

    // const RunSqlStatements = new cdk.CustomResource(this, 'RunSqlStatements', {
    //   serviceToken: sqlLambdaProvider.serviceToken,
    // });

    // //// Here we execute the sql statements sequentially.
    // const createPGExtenstion = ExecuteSQLStatementRescource(this, 'createPGExtenstion', {
    //   vectorStorePostgresCluster: vectorStorePostgresCluster,
    //   sql_command: /* sql */`
    //     CREATE EXTENSION IF NOT EXISTS vector;
    //     `
    // })

    // const createSchema = ExecuteSQLStatementRescource(this, 'createSchema', {
    //   vectorStorePostgresCluster: vectorStorePostgresCluster,
    //   sql_command: /* sql */`
    //     CREATE SCHEMA ${schemaName};
    //     `
    // })
    // createSchema.node.addDependency(createPGExtenstion)

    // const createVectorTable = ExecuteSQLStatementRescource(this, 'createVectorTable', {
    //   vectorStorePostgresCluster: vectorStorePostgresCluster,
    //   sql_command: /* sql */`
    //     CREATE TABLE ${schemaName}.${tableName} (
    //     ${primaryKeyField} uuid PRIMARY KEY,
    //     ${vectorField} vector(${vectorDimensions}),
    //     ${textField} text, 
    //     ${metadataField} json
    //   );
    //     `
    // })
    // createVectorTable.node.addDependency(createSchema)

    // const createIndex = ExecuteSQLStatementRescource(this, 'createIndex', {
    //   vectorStorePostgresCluster: vectorStorePostgresCluster,
    //   sql_command: /* sql */`
    //     CREATE INDEX on ${schemaName}.${tableName}
    //     USING hnsw (${vectorField} vector_cosine_ops);
    //     `
    // })
    // createIndex.node.addDependency(createVectorTable)



    // // const customResourceLambda = new lambda.Function(this, 'CustomResourceLambda', {
    // //   runtime: lambda.Runtime.NODEJS_18_X,
    // //   code: lambda.Code.fromInline(`
    // //     import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

    // //     const rdsDataClient = new RDSDataClient({});

    // //     export const handler = async (event) => {
    // //       console.log('Event: ', JSON.stringify(event, null, 2));

    // //       // Define RDS Data Service parameters
    // //       const database = process.env.DATABASE_NAME;
    // //       const clusterArn = process.env.CLUSTER_ARN;
    // //       const secretArn = process.env.SECRET_ARN;

    // //       // Array of SQL statements to execute
    // //       const sqlStatements = [
    // //         'INSERT INTO my_table (column1) VALUES (1)',
    // //         'INSERT INTO my_table (column1) VALUES (2)',
    // //         'INSERT INTO my_table (column1) VALUES (3)'
    // //       ];

    // //       try {
    // //         // Execute each SQL statement in sequence
    // //         for (const sql of sqlStatements) {
    // //           const params = {
    // //             resourceArn: clusterArn,
    // //             secretArn: secretArn,
    // //             sql: sql,
    // //             database: database
    // //           };

    // //           const command = new ExecuteStatementCommand(params);
    // //           const result = await rdsDataClient.send(command);
    // //           console.log('Statement executed:', sql, 'Result:', result);
    // //         }

    // //         return {
    // //           Status: 'SUCCESS',
    // //           PhysicalResourceId: event.PhysicalResourceId || 'CustomResourceId',
    // //           Data: { Message: 'SQL statements executed successfully!' }
    // //         };

    // //       } catch (error) {
    // //         console.error('Error executing SQL statements:', error);
    // //         throw new Error('Failed to execute SQL statements');
    // //       }
    // //     };
    // //   `),
    // //   handler: 'index.handler',
    // //   environment: {
    // //     DATABASE_NAME: 'your_database_name',
    // //     CLUSTER_ARN: 'your_cluster_arn',
    // //     SECRET_ARN: 'your_secret_arn'
    // //   },
    // //   }
    // // });

    // // Define the Lambda function inline
    // const customResourceLambda = new lambda.Function(this, 'EnablePgvectorExtensionAndCreateEmbeddingsTableLambda', {
    //   runtime: lambda.Runtime.NODEJS_18_X,
    //   code: lambda.Code.fromInline(`
    //     const AWS = require('aws-sdk');
    //     const rdsData = new AWS.RDSDataService();

    //     exports.handler = async function(event) {
    //       console.log('Event: ', JSON.stringify(event, null, 2));

    //       // Define RDS Data Service parameters
    //       const database = process.env.DATABASE_NAME;
    //       const clusterArn = process.env.CLUSTER_ARN;
    //       const secretArn = process.env.SECRET_ARN;

    //       // Array of SQL statements to execute
    //       const sqlStatements = JSON.parse(${JSON.stringify(sql_commands)})

    //       try {
    //         // Execute each SQL statement in sequence
    //         for (const sql of sqlStatements) {
    //           const params = {
    //             resourceArn: clusterArn,
    //             secretArn: secretArn,
    //             sql: sql,
    //             database: database
    //           };

    //           const result = await rdsData.executeStatement(params).promise();
    //           console.log('Statement executed:', sql, 'Result:', result);
    //         }

    //         return {
    //           Status: 'SUCCESS',
    //           PhysicalResourceId: event.PhysicalResourceId || 'CustomResourceId',
    //           Data: { Message: 'SQL statements executed successfully!' }
    //         };

    //       } catch (error) {
    //         console.error('Error executing SQL statements:', error);
    //         throw new Error('Failed to execute SQL statements');
    //       }
    //     };
    //   `),
    //   handler: 'index.handler',
    //   environment: {
    //     DATABASE_NAME: 'your_database_name',
    //     CLUSTER_ARN: 'your_cluster_arn',
    //     SECRET_ARN: 'your_secret_arn'
    //   }
    // });

    // // Define the custom resource provider
    // const provider = new cr.Provider(this, 'EnablePgvectorExtensionAndCreateEmbeddingsTableProvider', {
    //   onEventHandler: customResourceLambda,
    // });

    // // Create the custom resource
    // new cdk.CustomResource(this, 'EnablePgvectorExtensionAndCreateEmbeddingsTable', {
    //   serviceToken: provider.serviceToken,
    // });





    // const sqlCommandCustomResources = sql_commands.forEach((sql_command) => {
    //   const enablePgvectorCR = new cr.AwsCustomResource(this, 'EnablePgvectorExtensionAndCreateEmbeddingsTable', {
    //     onCreate: {
    //       service: 'RDSDataService',
    //       action: 'executeStatement',
    //       parameters: {
    //         resourceArn: vectorStorePostgresCluster.clusterArn,
    //         database: defaultDatabaseName,
    //         sql: sql_command,
    //         secretArn: vectorStorePostgresCluster.secret!.secretArn,
    //       },
    //       physicalResourceId: cr.PhysicalResourceId.of('EnablePgvectorExtensionAndCreateEmbeddingsTable'),
    //     },
    //     policy: cr.AwsCustomResourcePolicy.fromStatements([
    //       new iam.PolicyStatement({
    //         actions: [
    //           'rds-data:ExecuteStatement',
    //         ],
    //         resources: [vectorStorePostgresCluster.clusterArn],
    //       }),
    //       new iam.PolicyStatement({
    //         actions: ['secretsmanager:GetSecretValue'],
    //         resources: [vectorStorePostgresCluster.secret!.secretArn],
    //       }),
    //     ]),
    //   });
    //   enablePgvectorCR.node.addDependency(vectorStorePostgresCluster);
    //   if (latestSQLExecutionResource) enablePgvectorCR.node.addDependency(latestSQLExecutionResource);
    //   latestSQLExecutionResource = enablePgvectorCR
    //   return enablePgvectorCR
    // })

    // Create a custom resource to enable pgvector extension
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/RDSDataService.html#executeStatement-property




    const knoledgeBaseRole = new iam.Role(this, 'sqlTableKbRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        'KnowledgeBasePolicies': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'rds-data:ExecuteStatement',
                'rds-data:BatchExecuteStatement',
                'rds:DescribeDBClusters'
              ],
              resources: [vectorStorePostgresCluster.clusterArn],
            }),
            new iam.PolicyStatement({
              actions: ['secretsmanager:GetSecretValue'],
              resources: [vectorStorePostgresCluster.secret!.secretArn],
            }),
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel'],
              resources: [this.embeddingModelArn],
            }),
            new iam.PolicyStatement({
              actions: [
                's3:*', //TODO scope this down
                's3:ListBucket',
                's3:GetObject'
              ],
              resources: [
                props.bucket.bucketArn,
                props.bucket.bucketArn + `/*`
              ],
            }),
          ],
        })
      }
    })

    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: `${id}-${rootStack.stackName.slice(-5)}`,
      roleArn: knoledgeBaseRole.roleArn,
      description: 'This knowledge base stores sql table definitions',
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${rootStack.region}::foundation-model/cohere.embed-multilingual-v3`
        }
      },
      storageConfiguration: {
        type: 'RDS',
        rdsConfiguration: {
          credentialsSecretArn: vectorStorePostgresCluster.secret!.secretArn,
          databaseName: defaultDatabaseName,
          fieldMapping: {
            metadataField: metadataField,
            primaryKeyField: primaryKeyField,
            textField: textField,
            vectorField: vectorField,
          },
          resourceArn: vectorStorePostgresCluster.clusterArn,
          tableName: `${schemaName}.${tableName}`,
        },
      }
    });

    this.knowledgeBase.node.addDependency(runSQLStatements);
  }
}




