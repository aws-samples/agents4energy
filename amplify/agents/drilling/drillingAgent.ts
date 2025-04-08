import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface DrillingAgentProps {
  vpc: ec2.Vpc;
  s3Deployment: s3Deployment.BucketDeployment;
  s3Bucket: s3.IBucket;
}

export function drillingAgentBuilder(scope: Construct, props: DrillingAgentProps) {
  // Create the drilling agent
  const drillingAgent = new bedrock.CfnAgent(scope, 'DrillingAgent', {
    agentName: 'DrillingAgent',
    instruction: `You are the Drilling Agent, specialized in drilling operations and optimization for energy companies.

You have access to the following structured data tables:
- drilling_operations: Contains information about drilling operations, including well details and performance metrics
- drilling_events: Contains information about drilling events, incidents, and their resolution

When asked about operational data, you should query these tables using Athena SQL.
For example:
- To find all wells with high ROP: SELECT * FROM agents4energy_db.drilling_operations WHERE avg_rop_ft_hr > 70
- To find stuck pipe events: SELECT * FROM agents4energy_db.drilling_events WHERE event_type = 'Stuck Pipe'

For general knowledge questions, rely on your training data.`,
    foundationModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
    customerEncryptionKeyArn: undefined,
    description: 'Drilling Agent for drilling operations and optimization',
    idleSessionTtlInSeconds: 1800,
  });

  // Create the agent alias
  const drillingAgentAlias = new bedrock.CfnAgentAlias(scope, 'DrillingAgentAlias', {
    agentId: drillingAgent.attrAgentId,
    agentAliasName: 'PROD',
    description: 'Production alias for the Drilling Agent',
    routingConfiguration: [
      {
        agentVersion: '$LATEST',
      },
    ],
  });

  return {
    drillingAgent,
    drillingAgentAlias,
  };
}
