import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface RegulatoryAgentProps {
  vpc: ec2.Vpc;
  s3Deployment: s3Deployment.BucketDeployment;
  s3Bucket: s3.IBucket;
}

export function regulatoryAgentBuilder(scope: Construct, props: RegulatoryAgentProps) {
  // Create the regulatory agent
  const regulatoryAgent = new bedrock.CfnAgent(scope, 'RegulatoryAgent', {
    agentName: 'RegulatoryAgent',
    instruction: `You are the Regulatory Agent, specialized in compliance and regulatory reporting for energy companies.

You have access to the following structured data tables:
- compliance_reports: Contains information about compliance reports, inspections, and findings
- permits: Contains information about permits, their status, and renewal information

When asked about operational data, you should query these tables using Athena SQL.
For example:
- To find all open compliance issues: SELECT * FROM agents4energy_db.compliance_reports WHERE status = 'Open'
- To find expired permits: SELECT * FROM agents4energy_db.permits WHERE status = 'Expired'

For general knowledge questions, rely on your training data.`,
    foundationModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
    customerEncryptionKeyArn: undefined,
    description: 'Regulatory Agent for compliance and regulatory reporting',
    idleSessionTtlInSeconds: 1800,
  });

  // Create the agent alias
  const regulatoryAgentAlias = new bedrock.CfnAgentAlias(scope, 'RegulatoryAgentAlias', {
    agentId: regulatoryAgent.attrAgentId,
    agentAliasName: 'PROD',
    description: 'Production alias for the Regulatory Agent',
    routingConfiguration: [
      {
        agentVersion: '$LATEST',
      },
    ],
  });

  // Create a CloudWatch metric for the agent
  const metric = new cdk.aws_cloudwatch.Metric({
    namespace: 'AWS/Bedrock',
    metricName: 'InvokeAgentRequests',
    dimensionsMap: {
      AgentId: regulatoryAgent.attrAgentId,
      AgentAliasId: regulatoryAgentAlias.attrAgentAliasId,
    },
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  return {
    regulatoryAgent,
    regulatoryAgentAlias,
    metric,
  };
}
