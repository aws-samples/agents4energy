"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLlmAgentPolicies = void 0;
var cdk = require("aws-cdk-lib");
var iam = require("aws-cdk-lib/aws-iam");
var addLlmAgentPolicies = function (props) {
    props.role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel*"],
        resources: [
            "arn:aws:bedrock:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":inference-profile/*"),
            "arn:aws:bedrock:us-*::foundation-model/*",
        ],
    }));
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
        ],
        resources: ["arn:aws:athena:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":workgroup/").concat(props.athenaWorkgroup.name)],
    }));
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'athena:GetDataCatalog'
        ],
        resources: ["arn:aws:athena:*:*:datacatalog/*"], // This function must be able to invoke data catalogs in other accoutns.
        conditions: {
            'StringEquals': {
                'aws:ResourceTag/AgentsForEnergy': 'true'
            }
        }
    }));
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            'athena:GetDataCatalog'
        ],
        resources: ["arn:aws:athena:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":datacatalog/AwsDataCatalog")],
    }));
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            "glue:GetDatabase",
            "glue:GetDatabases",
            "glue:GetTable",
            "glue:GetTables",
            "glue:GetPartitions",
            "glue:BatchGetPartition",
        ],
        resources: [
            "arn:aws:glue:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":catalog"),
            "arn:aws:glue:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":database/*"),
            "arn:aws:glue:".concat(props.rootStack.region, ":").concat(props.rootStack.account, ":table/*")
        ],
    }));
    //Allow the function to invoke the lambda used to connect Athena to the postgres db
    props.role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: ["arn:aws:lambda:*:*:*"], //This function must be able to invoke lambda functions in other accounts so to query Athena federated data sources in other accounts.
        conditions: {
            'StringEquals': {
                'aws:ResourceTag/AgentsForEnergy': 'true'
            }
        }
    }));
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts",
            "s3:AbortMultipartUpload",
            "s3:PutObject",
        ],
        resources: [
            props.s3Bucket.bucketArn,
            props.s3Bucket.arnForObjects("*")
        ],
    }));

    // Add EC2 network interface permissions for VPC Lambda functions
    props.role.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
        actions: [
            "ec2:CreateNetworkInterface",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface",
            "ec2:AssignPrivateIpAddresses",
            "ec2:UnassignPrivateIpAddresses"
        ],
        resources: ["*"]
    }));
};
exports.addLlmAgentPolicies = addLlmAgentPolicies;
