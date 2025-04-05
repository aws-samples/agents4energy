"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuroraBedrockKnowledgeBase = void 0;
var cdk = require("aws-cdk-lib");
var aws_cdk_lib_1 = require("aws-cdk-lib");
var constructs_1 = require("constructs");
var AuroraBedrockKnowledgeBase = /** @class */ (function (_super) {
    __extends(AuroraBedrockKnowledgeBase, _super);
    function AuroraBedrockKnowledgeBase(scope, id, props) {
        var _a, _b;
        var _this = _super.call(this, scope, id) || this;
        _this.vectorStoreSchemaName = props.schemaName;
        var defaultDatabaseName = 'bedrock_vector_db';
        var tableName = 'bedrock_kb';
        var primaryKeyField = 'id';
        var vectorField = 'embedding';
        var textField = 'chunks';
        var metadataField = 'metadata';
        var vectorDimensions = 1024;
        var stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
        var rootStack = cdk.Stack.of(scope).nestedStackParent;
        if (!rootStack)
            throw new Error('Root stack not found');
        // this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/cohere.embed-multilingual-v3` //512 token window
        _this.embeddingModelArn = "arn:aws:bedrock:".concat(rootStack.region, "::foundation-model/amazon.titan-embed-text-v2:0"); //8k token window
        //If a database cluster is not supplied in the props, create one
        _this.vectorStorePostgresCluster = props.vectorStorePostgresCluster ? props.vectorStorePostgresCluster :
            new aws_cdk_lib_1.aws_rds.DatabaseCluster(scope, "VectorStore-".concat(id, "-").concat(stackUUID), {
                engine: aws_cdk_lib_1.aws_rds.DatabaseClusterEngine.auroraPostgres({
                    version: aws_cdk_lib_1.aws_rds.AuroraPostgresEngineVersion.VER_16_4,
                }),
                enableDataApi: true,
                iamAuthentication: true,
                storageEncrypted: true,
                defaultDatabaseName: defaultDatabaseName,
                writer: aws_cdk_lib_1.aws_rds.ClusterInstance.serverlessV2('writer'),
                serverlessV2MinCapacity: 0.5,
                serverlessV2MaxCapacity: 2,
                vpcSubnets: {
                    subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                vpc: props.vpc,
                port: 5432,
                backup: {
                    retention: cdk.Duration.days(7),
                    preferredWindow: '03:00-04:00'
                },
                deletionProtection: false,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            });
        (_a = _this.vectorStorePostgresCluster.secret) === null || _a === void 0 ? void 0 : _a.addRotationSchedule('RotationSchedule', {
            hostedRotation: aws_cdk_lib_1.aws_secretsmanager.HostedRotation.postgreSqlSingleUser({
                functionName: "SecretRotation-".concat(id, "-").concat(stackUUID)
            }),
            automaticallyAfter: cdk.Duration.days(30),
        });
        // Wait until this writer node is created before running sql queries against the db
        _this.vectorStoreWriterNode = _this.vectorStorePostgresCluster.node.findChild('writer').node.defaultChild;
        // Create a Lambda function that runs SQL statements to prepare the postgres cluster to be a vector store
        var prepVectorStoreFunction = new aws_cdk_lib_1.aws_lambda.Function(scope, "PrepVectorStoreFunction-".concat(id), {
            runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            timeout: cdk.Duration.minutes(10),
            code: aws_cdk_lib_1.aws_lambda.Code.fromInline("\n          const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');\n\n          const rdsDataClient = new RDSDataClient();\n\n          exports.handler = async () => {\n\n              const sqlCommands = [\n                /* sql */ `\n                CREATE EXTENSION IF NOT EXISTS vector;\n                `, /* sql */ `\n                CREATE SCHEMA ".concat(props.schemaName, ";\n                `,/* sql */`\n                CREATE TABLE ").concat(props.schemaName, ".").concat(tableName, " (\n                ").concat(primaryKeyField, " uuid PRIMARY KEY,\n                ").concat(vectorField, " vector(").concat(vectorDimensions, "),\n                ").concat(textField, " text, \n                ").concat(metadataField, " json\n                );\n                `, /* sql */ `\n                CREATE INDEX on ").concat(props.schemaName, ".").concat(tableName, "\n                USING hnsw (").concat(vectorField, " vector_cosine_ops);\n                `, /* sql */ `\n                CREATE INDEX on ").concat(props.schemaName, ".").concat(tableName, " \n                USING gin (to_tsvector('simple', ").concat(textField, "));\n                `\n              ]\n              \n              for (const sqlCommand of sqlCommands) {\n                  const params = {\n                      resourceArn: '").concat(_this.vectorStorePostgresCluster.clusterArn, "',\n                      secretArn: '").concat((_b = _this.vectorStorePostgresCluster.secret) === null || _b === void 0 ? void 0 : _b.secretArn, "',\n                      database: '").concat(defaultDatabaseName, "',\n                      sql: sqlCommand\n                  };\n\n                  console.log('Executing SQL command:', sqlCommand)\n\n                  const command = new ExecuteStatementCommand(params);\n                  await rdsDataClient.send(command);\n              }\n          };\n          ")),
        });
        prepVectorStoreFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['rds-data:ExecuteStatement'],
            resources: [_this.vectorStorePostgresCluster.clusterArn],
        }));
        prepVectorStoreFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [_this.vectorStorePostgresCluster.secret.secretArn],
        }));
        // Create a Custom Resource that invokes the lambda function
        var prepVectorStore = new aws_cdk_lib_1.custom_resources.AwsCustomResource(scope, "PrepVectorStoreCluster-".concat(id), {
            onCreate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                    FunctionName: prepVectorStoreFunction.functionName,
                    Payload: JSON.stringify({}), // No need to pass an event
                },
                physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('SqlExecutionResource'),
            },
            policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromStatements([
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [prepVectorStoreFunction.functionArn],
                }),
            ]),
        });
        prepVectorStore.node.addDependency(_this.vectorStoreWriterNode);
        var knowledgeBaseRole = new aws_cdk_lib_1.aws_iam.Role(_this, "KbRole-".concat(id), {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
            inlinePolicies: {
                'KnowledgeBasePolicies': new aws_cdk_lib_1.aws_iam.PolicyDocument({
                    statements: [
                        new aws_cdk_lib_1.aws_iam.PolicyStatement({
                            actions: [
                                'rds-data:ExecuteStatement',
                                'rds-data:BatchExecuteStatement',
                                'rds:DescribeDBClusters'
                            ],
                            resources: [_this.vectorStorePostgresCluster.clusterArn],
                        }),
                        new aws_cdk_lib_1.aws_iam.PolicyStatement({
                            actions: ['secretsmanager:GetSecretValue'],
                            resources: [_this.vectorStorePostgresCluster.secret.secretArn],
                        }),
                        new aws_cdk_lib_1.aws_iam.PolicyStatement({
                            actions: ['bedrock:InvokeModel'],
                            resources: [_this.embeddingModelArn],
                        }),
                        new aws_cdk_lib_1.aws_iam.PolicyStatement({
                            actions: [
                                's3:ListBucket',
                                's3:GetObject'
                            ],
                            resources: [
                                props.bucket.bucketArn,
                                props.bucket.bucketArn + "/*"
                            ],
                        }),
                    ],
                })
            }
        });
        _this.knowledgeBase = new aws_cdk_lib_1.aws_bedrock.CfnKnowledgeBase(_this, "KnowledgeBase", {
            name: "".concat(id.slice(0, 60), "-").concat(stackUUID),
            roleArn: knowledgeBaseRole.roleArn,
            description: 'This knowledge base stores sql table definitions',
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn: _this.embeddingModelArn
                }
            },
            storageConfiguration: {
                type: 'RDS',
                rdsConfiguration: {
                    credentialsSecretArn: _this.vectorStorePostgresCluster.secret.secretArn,
                    databaseName: defaultDatabaseName,
                    fieldMapping: {
                        metadataField: metadataField,
                        primaryKeyField: primaryKeyField,
                        textField: textField,
                        vectorField: vectorField,
                    },
                    resourceArn: _this.vectorStorePostgresCluster.clusterArn,
                    tableName: "".concat(props.schemaName, ".").concat(tableName),
                },
            }
        });
        _this.knowledgeBase.node.addDependency(prepVectorStore);
        return _this;
    }
    return AuroraBedrockKnowledgeBase;
}(constructs_1.Construct));
exports.AuroraBedrockKnowledgeBase = AuroraBedrockKnowledgeBase;
