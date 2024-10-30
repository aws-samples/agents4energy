import * as cdk from 'aws-cdk-lib';
import {
  aws_s3 as s3,
  aws_ec2 as ec2,
  aws_bedrock as bedrock,
  aws_rds as rds,
  aws_iam as iam,
  custom_resources as cr
} from 'aws-cdk-lib';
// import { bedrock as cdkLabsBedrock } from "@cdklabs/generative-ai-cdk-constructs";
import { Construct } from 'constructs';

export interface StaticSiteProps {
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

export class AuroraBedrockKnoledgeBase extends Construct {
  //   public readonly bucket: s3.Bucket;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly embeddingModelArn: string

  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/cohere.embed-multilingual-v3`

    

    const vectorStorePostgresCluster = new rds.ServerlessCluster(this, 'VectorStoreAuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_13_9,
      }),
      scaling: {
        autoPause: cdk.Duration.minutes(10), // default is to pause after 5 minutes
        minCapacity: rds.AuroraCapacityUnit.ACU_2, // minimum of 2 Aurora capacity units
        maxCapacity: rds.AuroraCapacityUnit.ACU_16, // maximum of 16 Aurora capacity units
      },
      defaultDatabaseName: defaultDatabaseName,
      // parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
      //     engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_14_6 }),
      //     parameters: {
      //       'shared_preload_libraries': 'pgvector',
      //     },
      //   }),
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

    const sql_commands = [
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

    // Create a custom resource to enable pgvector extension
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/RDSDataService.html#executeStatement-property
    const enablePgvectorCR = new cr.AwsCustomResource(this, 'EnablePgvectorExtensionAndCreateEmbeddingsTable', {
      onCreate: {
        service: 'RDSDataService',
        action: 'executeStatement',
        parameters: {
          resourceArn: vectorStorePostgresCluster.clusterArn,
          database: defaultDatabaseName,
          sql: sql_commands.join('\n\n'),
          secretArn: vectorStorePostgresCluster.secret!.secretArn,
        },
        physicalResourceId: cr.PhysicalResourceId.of('EnablePgvectorExtensionAndCreateEmbeddingsTable'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['rds-data:ExecuteStatement'],
          resources: [vectorStorePostgresCluster.clusterArn],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [vectorStorePostgresCluster.secret!.secretArn],
        }),
        new iam.PolicyStatement({
          actions: [
            's3:*', //TODO scope this down
            's3:ListBucket',
            's3:GetObject'
          ],
          resources: [props.bucket.bucketArn],
        }),
      ]),
      // policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
      //   resources: [vectorStorePostgresCluster.clusterArn, vectorStorePostgresCluster.secret!.secretArn],
      // }),
      // installLatestAwsSdk: true,
    });

    enablePgvectorCR.node.addDependency(vectorStorePostgresCluster);

    const knoledgeBaseRole = new iam.Role(this, 'sqlTableKbRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        'KnowledgeBasePolicies': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'rds-data:ExecuteStatement',
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
          ],
        })
      }
    })

    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: `${rootStack.stackName}-${id}`,
      roleArn: knoledgeBaseRole.roleArn,
      description: 'This is my Bedrock Knowledge Base',
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
  
    this.knowledgeBase.node.addDependency(enablePgvectorCR);
  }
}




