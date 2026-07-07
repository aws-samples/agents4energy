import { Construct } from 'constructs';
import {
    aws_iam as iam,
    custom_resources,
} from 'aws-cdk-lib';

export interface SeedDataProps {
    settingsTableName: string;
    customResourceRole?: iam.IRole;
    /** When provided, seeds a default Agent + MCP server assignment. */
    agentTableName?: string;
    mcpServerTableName?: string;
    agentMcpServerTableName?: string;
    /** Dispatcher gateway MCP endpoint URL. */
    dispatcherGatewayUrl?: string;
}

export class SeedDataConstruct extends Construct {
    constructor(scope: Construct, id: string, props: SeedDataProps) {
        super(scope, id);

//         const systemPromptContent = `You are an advanced AI digital operations system which creates demos of how generative AI can improved digital operations workloads.
// Call tools in parallel when possible.

// When responding to the user:
// - You can create plots/charts/visualizations in the response. To render these, use an <iframe> with srcdoc containing the plot HTML.
//     - Only include one plot per iframe
//     - The srcdoc should contain ONLY the data visualization (charts, graphs, gauges, plots)
//     - Always use 100% width for the iframe
//     - Examples of what belongs in iframes: bar charts, line graphs, pie charts, scatter plots, gauges, interactive visualizations
// - CRITICAL: Do NOT put text content, alerts, status information, tables, lists, or any narrative content inside iframe srcdoc
//     - All text, headings, alerts, descriptions, tables, status updates, and narrative information MUST be in markdown format outside the iframe
//     - Examples of what should be markdown: safety alerts, event descriptions, operational status, recommendations, summaries, data tables
// - For all other response elements (text, lists, headings, tables, alerts, etc.), use markdown formatting, NOT HTML
// - The user prefers plots to text when reading your response.
// - After creating map layers, you can render the map using an iframe which links to the map page '<iframe src="/map">'

// Mapping guidance:
// - If you don't have the required data for a use case, generate realistic data
// - For mapping, you can define the latitude / longitude coordinates in the query script
// - After creating a map layer, render the map '<iframe src="/map">' in your response.

// ## PySpark tool guidance:
// Perfer saving plots as html. This lets the user interact with the plots in the front end.
// When saving image files (png, jpg, etc.), link to them using an iframe with the /artifacts/ path:
//   <iframe src="/artifacts/plots/my_image.png" width="100%" height="600px"></iframe>
// Do NOT use markdown image syntax like ![alt](url) — always use an iframe with the /artifacts/ path so the app can resolve and display the image.
// Use relative file paths, and not absolute file paths.

// AFTER RESPONDING: Call the generate_suggestions tool to provide 2-3 helpful follow-up questions the user might want to ask.
// `;

        const roleOrPolicy = props.customResourceRole
            ? { role: props.customResourceRole }
            : { policy: custom_resources.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    actions: ['dynamodb:PutItem'],
                    resources: ['*'],
                }),
              ]) };

        // new custom_resources.AwsCustomResource(this, 'SystemPromptSeedData', {
        //     onCreate: {
        //         service: 'DynamoDB',
        //         action: 'putItem',
        //         parameters: {
        //             TableName: props.settingsTableName,
        //             Item: {
        //                 name: { S: 'system_prompt' },
        //                 value: { S: systemPromptContent },
        //                 id: { S: 'system_prompt_setting' },
        //                 __typename: { S: 'Settings' },
        //                 createdAt: { S: '2024-01-01T00:00:00.000Z' },
        //                 updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        //                 owner: { S: 'system' },
        //             }
        //         },
        //         physicalResourceId: custom_resources.PhysicalResourceId.of('SystemPromptSeedData')
        //     },
        //     onUpdate: {
        //         service: 'DynamoDB',
        //         action: 'putItem',
        //         parameters: {
        //             TableName: props.settingsTableName,
        //             Item: {
        //                 name: { S: 'system_prompt' },
        //                 value: { S: systemPromptContent },
        //                 id: { S: 'system_prompt_setting' },
        //                 __typename: { S: 'Settings' },
        //                 createdAt: { S: '2024-01-01T00:00:00.000Z' },
        //                 updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        //                 owner: { S: 'system' },
        //             }
        //         },
        //         physicalResourceId: custom_resources.PhysicalResourceId.of('SystemPromptSeedData')
        //     },
        //     ...roleOrPolicy,
        // });

        // Seed the default Agent + McpServer + AgentMcpServer records so the
        // agent-server can route to the dispatcher gateway without manual UI setup.
        if (
            props.agentTableName &&
            props.mcpServerTableName &&
            props.agentMcpServerTableName &&
            props.dispatcherGatewayUrl
        ) {
            const defaultAgentId = 'seed-default-agent';
            const defaultMcpServerId = 'seed-default-mcp-server';
            const defaultAssignmentId = 'seed-default-assignment';
            const now = '2024-01-01T00:00:00.000Z';

            const defaultAgentSystemPrompt = `You are a helpful AI assistant that can coordinate multiple specialized sub-agents to complete complex tasks.

You have access to an invoke_agent tool that lets you delegate tasks to specialized agents by their slug. Use it when:
- A task requires specialized expertise that another agent can provide
- You want to run parallel workstreams by delegating to multiple agents
- The user's request maps to a specific agent's domain

When delegating, provide clear, specific prompts to the sub-agent so it can complete the task without additional context.
After receiving a sub-agent's response, synthesize the results and provide a cohesive answer to the user.

Always be transparent about which agents you're invoking and why.`;

            new custom_resources.AwsCustomResource(this, 'DefaultAgentSeedData', {
                onCreate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.agentTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultAgentId },
                            name: { S: 'Default Agent' },
                            slug: { S: 'default' },
                            description: { S: 'Default digital operations agent with multi-agent orchestration' },
                            systemPromptText: { S: defaultAgentSystemPrompt },
                            enabled: { BOOL: true },
                            __typename: { S: 'Agent' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultAgentSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                onUpdate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.agentTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultAgentId },
                            name: { S: 'Default Agent' },
                            slug: { S: 'default' },
                            description: { S: 'Default digital operations agent with multi-agent orchestration' },
                            systemPromptText: { S: defaultAgentSystemPrompt },
                            enabled: { BOOL: true },
                            __typename: { S: 'Agent' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultAgentSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                ...roleOrPolicy,
            });

            new custom_resources.AwsCustomResource(this, 'DefaultMcpServerSeedData', {
                onCreate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.mcpServerTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultMcpServerId },
                            name: { S: 'Dispatcher Gateway' },
                            url: { S: props.dispatcherGatewayUrl },
                            description: { S: 'AgentCore dispatcher gateway — all agent tools (GraphQL, S3, RAG, PySpark, map layers, action items, workover jobs)' },
                            serverType: { S: 'agentcore' },
                            enabled: { BOOL: true },
                            __typename: { S: 'McpServer' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultMcpServerSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                onUpdate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.mcpServerTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultMcpServerId },
                            name: { S: 'Dispatcher Gateway' },
                            url: { S: props.dispatcherGatewayUrl },
                            description: { S: 'AgentCore dispatcher gateway — all agent tools (GraphQL, S3, RAG, PySpark, map layers, action items, workover jobs)' },
                            serverType: { S: 'agentcore' },
                            enabled: { BOOL: true },
                            __typename: { S: 'McpServer' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultMcpServerSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                ...roleOrPolicy,
            });

            new custom_resources.AwsCustomResource(this, 'DefaultAgentMcpServerSeedData', {
                onCreate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.agentMcpServerTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultAssignmentId },
                            agentId: { S: defaultAgentId },
                            mcpServerId: { S: defaultMcpServerId },
                            __typename: { S: 'AgentMcpServer' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultAgentMcpServerSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                onUpdate: {
                    service: 'DynamoDB',
                    action: 'putItem',
                    parameters: {
                        TableName: props.agentMcpServerTableName,
                        ConditionExpression: 'attribute_not_exists(id)',
                        Item: {
                            id: { S: defaultAssignmentId },
                            agentId: { S: defaultAgentId },
                            mcpServerId: { S: defaultMcpServerId },
                            __typename: { S: 'AgentMcpServer' },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                            owner: { S: 'system' },
                        },
                    },
                    physicalResourceId: custom_resources.PhysicalResourceId.of('DefaultAgentMcpServerSeedData'),
                    ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
                },
                ...roleOrPolicy,
            });
        }
    }
}
