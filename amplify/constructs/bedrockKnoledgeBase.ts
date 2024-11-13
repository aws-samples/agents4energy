import * as cdk from 'aws-cdk-lib';
import {
  aws_s3 as s3,
  aws_ec2 as ec2,
  aws_bedrock as bedrock,
  aws_rds as rds,
  aws_iam as iam,
  custom_resources as cr
} from 'aws-cdk-lib';
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
  sqlCommand: string
}) => (
  new cr.AwsCustomResource(scope, id, {
    onCreate: {
      service: 'RDSDataService',
      action: 'executeStatement',
      parameters: {
        resourceArn: props.vectorStorePostgresCluster.clusterArn,
        database: defaultDatabaseName,
        sql: props.sqlCommand,
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

    // this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/cohere.embed-multilingual-v3` //512 token window
    this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/amazon.titan-embed-text-v2:0` //8k token window

    // const vectorStorePostgresCluster = new rds.DatabaseCluster(scope, `VectorStoreAuroraCluster-${id}`, {
    const vectorStorePostgresCluster = new rds.DatabaseCluster(scope, 'VectorStoreAuroraCluster-1', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      enableDataApi: true,
      defaultDatabaseName: defaultDatabaseName,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      vpc: props.vpc,
      port: 2000,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    // Wait until this writer node is created before running sql queries against the db
    const writerNode = vectorStorePostgresCluster.node.findChild('writer').node.defaultChild as rds.CfnDBInstance

    //// Here we execute the sql statements sequentially.
    const createPGExtenstion = ExecuteSQLStatementRescource(this, 'createPGExtenstion', {
      vectorStorePostgresCluster: vectorStorePostgresCluster,
      sqlCommand: /* sql */`
        CREATE EXTENSION IF NOT EXISTS vector;
        `
    })
    createPGExtenstion.node.addDependency(writerNode)

    const createSchema = ExecuteSQLStatementRescource(this, 'createSchema', {
      vectorStorePostgresCluster: vectorStorePostgresCluster,
      sqlCommand: /* sql */`
        CREATE SCHEMA ${schemaName};
        `
    })
    createSchema.node.addDependency(createPGExtenstion)

    const createVectorTable = ExecuteSQLStatementRescource(this, 'createVectorTable', {
      vectorStorePostgresCluster: vectorStorePostgresCluster,
      sqlCommand: /* sql */`
        CREATE TABLE ${schemaName}.${tableName} (
        ${primaryKeyField} uuid PRIMARY KEY,
        ${vectorField} vector(${vectorDimensions}),
        ${textField} text, 
        ${metadataField} json
      );
        `
    })
    createVectorTable.node.addDependency(createSchema)

    const createIndex = ExecuteSQLStatementRescource(this, 'createIndex', {
      vectorStorePostgresCluster: vectorStorePostgresCluster,
      sqlCommand: /* sql */`
        CREATE INDEX on ${schemaName}.${tableName}
        USING hnsw (${vectorField} vector_cosine_ops);
        `
    })
    createIndex.node.addDependency(createVectorTable)

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
                // 's3:*', //TODO scope this down
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
      name: `${id}-${rootStack.stackName.slice(-5)}-1`,
      roleArn: knoledgeBaseRole.roleArn,
      description: 'This knowledge base stores sql table definitions',
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: this.embeddingModelArn
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
    this.knowledgeBase.node.addDependency(createIndex);
  }
}




