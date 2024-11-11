import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'


export const addLlmAgentPolicies = (props: {
    role: cdk.aws_iam.IRole,
    rootStack: cdk.Stack,
    athenaWorkgroup: cdk.aws_athena.CfnWorkGroup,
    s3Bucket: cdk.aws_s3.IBucket
}) => {

    props.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel*"],
          resources: [
            `arn:aws:bedrock:${props.rootStack.region}:${props.rootStack.account}:inference-profile/*`,
            `arn:aws:bedrock:us-*::foundation-model/*`,
            // `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
            // `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
            // `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
            // `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.*`,
          ],
        })
      )

    props.role.addToPrincipalPolicy(
        new cdk.aws_iam.PolicyStatement({
            actions: [
                'athena:StartQueryExecution',
                'athena:GetQueryExecution',
                'athena:GetQueryResults',
            ],
            resources: [`arn:aws:athena:${props.rootStack.region}:${props.rootStack.account}:workgroup/${props.athenaWorkgroup.name}`],
        })
    )

    props.role.addToPrincipalPolicy(
        new cdk.aws_iam.PolicyStatement({
            actions: [
                'athena:GetDataCatalog'
            ],
            resources: [`arn:aws:athena:*:*:datacatalog/*`], // This function must be able to invoke data catalogs in other accoutns.
            conditions: { // The data catalog must be tagged with `AgentsForEnergy: true` in order to be invoked.
                'StringEquals': {
                    'aws:ResourceTag/AgentsForEnergy': 'true'
                }
            }
        })
    )

    //Allow the function to invoke the lambda used to connect Athena to the postgres db
    props.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [`arn:aws:lambda:*:*:*`], //This function must be able to invoke lambda functions in other accounts so to query Athena federated data sources in other accounts.
            conditions: { //The lambda must be tagged with `AgentsForEnergy: true` in order to be invoked.
                'StringEquals': {
                    'aws:ResourceTag/AgentsForEnergy': 'true'
                }
            }
        }),
    )

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
    }))
}