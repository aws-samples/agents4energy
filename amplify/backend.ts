import path from 'path';
import { fileURLToPath } from 'url';

import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import {
  data,
  invokeBedrockAgentFunction,
  getStructuredOutputFromLangchainFunction,
  productionAgentFunction,
  planAndExecuteAgentFunction,
  // addIamDirectiveFunction
} from './data/resource';
import { preSignUp } from './functions/preSignUp/resource';
import { storage } from './storage/resource';

import * as cdk from 'aws-cdk-lib'
// import * as iam from 'aws-cdk-lib/aws-iam';
// import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  aws_iam as iam,
  aws_s3_deployment as s3Deployment,
  aws_ec2 as ec2,
  aws_lambda as lambda,
  custom_resources as cr,
} from 'aws-cdk-lib'

import { productionAgentBuilder } from "./custom/productionAgent"
import { AppConfigurator } from './custom/appConfigurator'

import { addLlmAgentPolicies } from './functions/utils/cdkUtils'

const resourceTags = {
  Project: 'agents-for-energy',
  Environment: 'dev',
  AgentsForEnergy: 'true'
}

const backend = defineBackend({
  auth,
  data,
  storage,
  invokeBedrockAgentFunction,
  getStructuredOutputFromLangchainFunction,
  productionAgentFunction,
  planAndExecuteAgentFunction,
  preSignUp
});

// backend.addOutput({
//   custom: {
//     api_id: backend.data.resources.graphqlApi.apiId,
//     root_stack_name: 
//   },
// });

const bedrockRuntimeDataSource = backend.data.resources.graphqlApi.addHttpDataSource(
  "bedrockRuntimeDS",
  `https://bedrock-runtime.${backend.auth.stack.region}.amazonaws.com`,
  {
    authorizationConfig: {
      signingRegion: backend.auth.stack.region,
      signingServiceName: "bedrock",
    },
  }
);

const bedrockAgentDataSource = backend.data.resources.graphqlApi.addHttpDataSource(
  "bedrockAgentDS",
  `https://bedrock-agent.${backend.auth.stack.region}.amazonaws.com`,
  {
    authorizationConfig: {
      signingRegion: backend.auth.stack.region,
      signingServiceName: "bedrock",
    },
  }
);

// const bedrockAgentRuntimeDataSource = backend.data.resources.graphqlApi.addHttpDataSource(
//   "bedrockAgentRuntimeDS",
//   `https://bedrock-agent-runtime.${backend.auth.stack.region}.amazonaws.com`,
//   {
//     authorizationConfig: {
//       signingRegion: backend.auth.stack.region,
//       signingServiceName: "bedrock",
//     },
//   }
// );

bedrockRuntimeDataSource.grantPrincipal.addToPrincipalPolicy(
  new iam.PolicyStatement({
    resources: [
      `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
      `arn:aws:bedrock:${backend.auth.stack.region}::foundation-model/anthropic.*`,
    ],
    actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
  })
);

bedrockAgentDataSource.grantPrincipal.addToPrincipalPolicy(
  new iam.PolicyStatement({
    resources: [
      `arn:aws:bedrock:${backend.auth.stack.region}:${backend.auth.stack.account}:*`,
    ],
    actions: [
      "bedrock:ListAgents",
      "bedrock:ListAgentAliases"
    ],
  })
);

// bedrockAgentRuntimeDataSource.grantPrincipal.addToPrincipalPolicy(
//   new iam.PolicyStatement({
//     resources: [
//       `arn:aws:bedrock:${backend.auth.stack.region}:${backend.auth.stack.account}:agent-alias/*`,
//     ],
//     actions: [
//       "bedrock:InvokeAgent",
//     ],

//   })
// );

backend.invokeBedrockAgentFunction.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    resources: [
      `arn:aws:bedrock:${backend.auth.stack.region}:${backend.auth.stack.account}:agent-alias/*`,
    ],
    actions: [
      "bedrock:InvokeAgent",
    ],
  }
  )
)

backend.getStructuredOutputFromLangchainFunction.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    resources: [
      `arn:aws:bedrock:${backend.auth.stack.region}:${backend.auth.stack.account}:inference-profile/*`,
      `arn:aws:bedrock:us-*::foundation-model/*`,
    ],
    actions: ["bedrock:InvokeModel"],
  })
)

const customStack = backend.createStack('productionAgentStack')
const rootStack = cdk.Stack.of(customStack).nestedStackParent
if (!rootStack) throw new Error('Root stack not found')

backend.addOutput({
  custom: {
    api_id: backend.data.resources.graphqlApi.apiId,
    root_stack_name: rootStack.stackName
  },
});

// const vpc = new ec2.Vpc(customStack, 'VPC', {
//   ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
// })

const vpc = new ec2.Vpc(customStack, 'A4E-VPC', {
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
  maxAzs: 3,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'public',
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      cidrMask: 24,
      name: 'private-with-egress',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
  ],
});
// Delete the VPC when the cloudformation  
vpc.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)

function applyTagsToRootStack() {
  if (!rootStack) throw new Error('Root stack not found')
  //Apply tags to all the nested stacks
  Object.entries(resourceTags).map(([key, value]) => {
    cdk.Tags.of(rootStack).add(key, value)
  })
  cdk.Tags.of(rootStack).add('rootStackName', rootStack.stackName)
}

applyTagsToRootStack()

//Deploy the test data to the s3 bucket
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const uploadToS3Deployment = new s3Deployment.BucketDeployment(customStack, 'sample-well-file-deployment', {
  sources: [s3Deployment.Source.asset(path.join(rootDir, 'sampleData'))],
  destinationBucket: backend.storage.resources.bucket,
  prune: false
  // destinationKeyPrefix: '/'
});

const {
  convertPdfToYamlFunction,
  triggerCrawlerSfnFunction,
  pdfProcessingQueue,
  defaultProdDatabaseName,
  hydrocarbonProductionDb,
  sqlTableDefBedrockKnoledgeBase,
  athenaWorkgroup,
  athenaPostgresCatalog,

} = productionAgentBuilder(customStack, {
  vpc: vpc,
  s3Deployment: uploadToS3Deployment, // This causes the assets here to not deploy until the s3 upload is complete.
  s3Bucket: backend.storage.resources.bucket,
  // appSyncApi: backend.data.resources.graphqlApi
})

// Custom resource Lambda to introduce a delay between when the PDF to Yaml function finishes deploying, and when the objects are uploaded.
const delayFunction = new lambda.Function(customStack, 'DelayFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  timeout: cdk.Duration.minutes(10),
  code: lambda.Code.fromInline(`
    exports.handler = async () => {
      console.log('Waiting for 60 seconds...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      console.log('Wait complete.');
      return { statusCode: 200 };
    };
  `),
});
const delayProvider = new cr.Provider(customStack, 'DelayProvider', {
  onEventHandler: delayFunction,
});
const delayResource = new cdk.CustomResource(customStack, 'DelayResource', {
  serviceToken: delayProvider.serviceToken,
});
delayResource.node.addDependency(convertPdfToYamlFunction)
delayResource.node.addDependency(triggerCrawlerSfnFunction)
delayResource.node.addDependency(pdfProcessingQueue)

uploadToS3Deployment.node.addDependency(delayResource) //Don't deploy files until the functions triggerCrawlerSfnFunction and convertPdfToYamlFunction are done deploying

backend.productionAgentFunction.addEnvironment('DATA_BUCKET_NAME', backend.storage.resources.bucket.bucketName)
backend.productionAgentFunction.addEnvironment('AWS_KNOWLEDGE_BASE_ID', sqlTableDefBedrockKnoledgeBase.knowledgeBase.attrKnowledgeBaseId)
backend.productionAgentFunction.addEnvironment('ATHENA_WORKGROUP_NAME', athenaWorkgroup.name)
backend.productionAgentFunction.addEnvironment('DATABASE_NAME', defaultProdDatabaseName)
backend.productionAgentFunction.addEnvironment('ATHENA_CATALOG_NAME', athenaPostgresCatalog.name)

addLlmAgentPolicies({
  role: backend.planAndExecuteAgentFunction.resources.lambda.role!,
  rootStack: rootStack,
  athenaWorkgroup: athenaWorkgroup,
  s3Bucket: backend.storage.resources.bucket
})

addLlmAgentPolicies({
  role: backend.productionAgentFunction.resources.lambda.role!,
  rootStack: rootStack,
  athenaWorkgroup: athenaWorkgroup,
  s3Bucket: backend.storage.resources.bucket
})

backend.productionAgentFunction.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["bedrock:Retrieve"],
    resources: [
      sqlTableDefBedrockKnoledgeBase.knowledgeBase.attrKnowledgeBaseArn
    ],
  })
)


// backend.productionAgentFunction.resources.lambda.addToRolePolicy(
//   new iam.PolicyStatement({
//     actions: ["states:StartSyncExecution"],
//     resources: [queryImagesStateMachineArn],
//   })
// )

// //Create data sources and resolvers for the lambdas created in the production agent stack
// const convertPdfToImageDS = backend.data.addLambdaDataSource(
//   'convertPdfToImageDS',
//   getInfoFromPdfFunction
// )

// convertPdfToImageDS.createResolver(
//   'getInfoFromPdfResolver',
//   {
//     typeName: 'Query',
//     fieldName: 'getInfoFromPdf'
//   }
// )

// Create a stack with the resources to configure the app
const configuratorStack = backend.createStack('configuratorStack')

new AppConfigurator(configuratorStack, 'appConfigurator', {
  hydrocarbonProductionDb: hydrocarbonProductionDb,
  defaultProdDatabaseName: defaultProdDatabaseName,
  // sqlTableDefBedrockKnoledgeBase: sqlTableDefBedrockKnoledgeBase,
  athenaWorkgroup: athenaWorkgroup,
  athenaPostgresCatalog: athenaPostgresCatalog,
  s3Bucket: backend.storage.resources.bucket,
  appSyncApi: backend.data.resources.graphqlApi,
  preSignUpFunction: backend.preSignUp.resources.lambda,
  cognitoUserPool: backend.auth.resources.userPool,
})