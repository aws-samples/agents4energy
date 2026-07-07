import { Construct } from 'constructs';
import { Duration, CustomResource, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface E2eTestUserProps {
  /** Cognito user pool to create the test user in. */
  userPoolId: string;
  /** ARN of that user pool, for scoping the custom resource's IAM policy. */
  userPoolArn: string;
  /** Email address for the generated test user. */
  email: string;
  /** SSM parameter path to store the test user's email (String). */
  emailSsmPath: string;
  /** SSM parameter path to store the test user's password (SecureString). */
  passwordSsmPath: string;
}

/**
 * Creates a Cognito test user with a cryptographically random password via a
 * CDK custom resource, storing both in SSM Parameter Store. Replaces the e2e
 * auth setup's prior self-bootstrap path (AdminCreateUser called directly
 * from the test runner), which required granting cognito-idp:AdminCreateUser
 * to whatever role runs the tests. Here that permission is scoped to the
 * deploy-time custom resource's own role; the test runner only needs
 * ssm:GetParameter.
 */
export class E2eTestUser extends Construct {
  constructor(scope: Construct, id: string, props: E2eTestUserProps) {
    super(scope, id);

    const fn = new NodejsFunction(this, 'Handler', {
      entry: resolve(__dirname, 'handler.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
    });

    fn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [props.userPoolArn],
    }));

    const stack = Stack.of(this);
    const toParameterArn = (path: string) => `arn:aws:ssm:${stack.region}:${stack.account}:parameter${path}`;

    fn.addToRolePolicy(new PolicyStatement({
      actions: ['ssm:PutParameter', 'ssm:DeleteParameter'],
      resources: [toParameterArn(props.emailSsmPath), toParameterArn(props.passwordSsmPath)],
    }));

    const provider = new Provider(this, 'Provider', {
      onEventHandler: fn,
    });

    new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPoolId,
        Email: props.email,
        EmailSsmPath: props.emailSsmPath,
        PasswordSsmPath: props.passwordSsmPath,
      },
    });
  }
}
