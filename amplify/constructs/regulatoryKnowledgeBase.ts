import * as cdk from 'aws-cdk-lib';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

interface RegulatoryKnowledgeBaseProps {
    description?: string;
    environment?: string;
    tags?: { [key: string]: string };
    bucketName?: string;
   
}

export function buildRegulatoryKb(scope: Construct, props: RegulatoryKnowledgeBaseProps) {
    const resourcePrefix = scope.node.tryGetContext('resourcePrefix') || 'regulatory';
    const environment = props.environment || scope.node.tryGetContext('environment') || 'dev';
    const bucketName = props.bucketName || 'regulatory-data';

    // Common tags
    const commonTags = {
        Environment: environment,
        Service: 'regulatory-kb',
        ManagedBy: 'CDK',
        ...props.tags
    };

    // Apply common tags to scope
    Object.entries(commonTags).forEach(([key, value]) => {
        cdk.Tags.of(scope).add(key, value);
    });

    // Create S3 Bucket for regulatory data
    const regulatoryBucket = new s3.Bucket(scope, 'regulatoryDataBucket', {
        bucketName: `${bucketName}-${environment}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        versioned: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [
            {
                enabled: true,
                noncurrentVersionExpiration: cdk.Duration.days(90),
                abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
            },
        ],
    });

    // Create IAM role for the Knowledge Base
    const kbRole = new iam.Role(scope, 'RegulatoryKbRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        roleName: `${resourcePrefix}-kb-role-${environment}`,
        description: 'Bedrock Knowledge Base execution role',
        inlinePolicies: {
            'kb-permissions': new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        actions: [
                            's3:GetObject',
                            's3:ListBucket',
                            'cloudwatch:PutMetricData'
                        ],
                        resources: [
                            regulatoryBucket.bucketArn,
                            `${regulatoryBucket.bucketArn}/*`
                        ]
                    })
                ]
            })
        }
    });

    // Create the Knowledge Base
    const knowledgeBase = new bedrock.CfnKnowledgeBase(scope, 'RegulatoryKnowledgeBase', {
        name: `${resourcePrefix}-kb-${environment}`,
        description: props.description || 'Knowledge base for regulatory compliance information',
        roleArn: kbRole.roleArn,
        knowledgeBaseConfiguration: {
            type: 'VECTOR',
            vectorKnowledgeBaseConfiguration: {
                embeddingModelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1'
            }
        },
       
    });

    // Create the data source
    const dataSource = new bedrock.CfnDataSource(scope, 'RegulatoryDataSource', {
        name: `${resourcePrefix}-datasource-${environment}`,
        description: 'Regulatory compliance data source',
        knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
        dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
                bucketArn: regulatoryBucket.bucketArn,
                inclusionPrefixes: ['regulatory/']
            }
        },
        vectorIngestionConfiguration: {
            chunkingConfiguration: {
                chunkingStrategy: 'FIXED_SIZE',
                fixedSizeChunkingConfiguration: {
                    maxTokens: 300,
                    overlapPercentage: 20
                }
            }
        }
    });

    dataSource.addDependency(knowledgeBase);

    // Apply removal policy
    knowledgeBase.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Outputs
    new cdk.CfnOutput(scope, 'knowledgeBaseId', {
        value: knowledgeBase.attrKnowledgeBaseId,
        description: 'Bedrock Knowledge Base ID'
    });

    new cdk.CfnOutput(scope, 'regulatoryBucketName', {
        value: regulatoryBucket.bucketName,
        description: 'Regulatory Data S3 Bucket Name'
    });

    new cdk.CfnOutput(scope, 'regulatoryBucketArn', {
        value: regulatoryBucket.bucketArn,
        description: 'Regulatory Data S3 Bucket ARN'
    });

    return {
        knowledgeBase,
        knowledgeBaseRole: kbRole,
        regulatoryBucket,
        dataSource
    };
}
