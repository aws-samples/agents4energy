import * as cdk from 'aws-cdk-lib';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';

import { VectorCollection } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/opensearchserverless'

import { Construct } from 'constructs';

export interface BedrockKnowledgeBaseProps {
    knowledgeBaseName: string;
}

export class BedrockKnowledgeBaseOSS extends Construct {
    // public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
    // public readonly collection: opensearchserverless.CfnCollection;
    public readonly embeddingModelArn: string;

    constructor(scope: Construct, id: string, props: BedrockKnowledgeBaseProps) {
        super(scope, id);

        // const collectionName = `collection-${id.slice(5).toLowerCase()}`

        const rootStack = cdk.Stack.of(scope).nestedStackParent
        if (!rootStack) throw new Error('Root stack not found')

        this.embeddingModelArn = `arn:aws:bedrock:${rootStack.region}::foundation-model/amazon.titan-embed-text-v2:0` //8k token window

        const vectorCollection = new VectorCollection(scope, 'VectorCollection', {
            collectionName: `collection-${id.slice(0,5).toLowerCase()}`,
            // standbyReplicas: {'ENABLED'}
        })

        // vectorCollection.

        // // Create basic security policy
        // const securityPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'SecurityPolicy', {
        //     name: `security-${id.slice(5).toLowerCase()}`,
        //     type: 'encryption',
        //     // policy: JSON.stringify({
        //     //     "Rules": [{
        //     //         "ResourceType": "collection",
        //     //         "Resource": [`collection/${collectionName}`]
        //     //     }],
        //     //     "AWSOwnedKey": true
        //     // }
        //     // )
        //     policy: JSON.stringify({
        //         Rules: [{
        //             Resource: [`collection/${collectionName}`],
        //             ResourceType: 'collection'
        //         }],
        //         AWSOwnedKey:true
        //     })
        // });


        // // Create OpenSearch Serverless Collection
        // this.collection = new opensearchserverless.CfnCollection(this, 'Collection', {
        //     name: collectionName,
        //     type: 'VECTORSEARCH',
        // });
        // this.collection.node.addDependency(securityPolicy);

        // // Create basic network policy
        // const networkPolicy = new opensearchserverless.CfnNetworkPolicy(this, 'NetworkPolicy', {
        //     name: `${props.collectionName}-network`,
        //     type: 'network-policy',
        //     policy: JSON.stringify([{
        //         Rules: [{
        //             Resource: [`collection/${props.collectionName}`],
        //             SourceVPCEndpoint: ['*']
        //         }],
        //         AllowFromPublic: true
        //     }])
        // });

        // // Create IAM Role
        // const role = new iam.Role(this, 'Role', {
        //     assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        // });

        // role.addToPolicy(new iam.PolicyStatement({
        //     actions: ['aoss:*'],
        //     resources: [this.collection.attrArn]
        // }));

        // // Create Knowledge Base
        // this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
        //     name: props.knowledgeBaseName,
        //     knowledgeBaseConfiguration: {
        //         type: 'VECTOR',
        //         vectorKnowledgeBaseConfiguration: {
        //             embeddingModelArn: props.embeddingModelArn,
        //         }
        //     },
        //     storageConfiguration: {
        //         type: 'OPENSEARCH_SERVERLESS',
        //         opensearchServerlessConfiguration: {
        //             collectionArn: this.collection.attrArn,
        //             fieldMapping: {
        //                 vectorField: 'vector_field',
        //                 textField: 'text_field',
        //                 metadataField: 'metadata'
        //             },
        //             vectorIndexName: 'vectorIndexName',
        //         }

        //     },
        //     roleArn: role.roleArn
        // });

        // // Add dependencies
        // this.knowledgeBase.node.addDependency(this.collection);
        // this.knowledgeBase.node.addDependency(securityPolicy);
        // this.knowledgeBase.node.addDependency(networkPolicy);
    }
}