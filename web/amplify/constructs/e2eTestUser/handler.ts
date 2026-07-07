import { randomBytes } from 'crypto';
import type { CdkCustomResourceEvent, CdkCustomResourceResponse } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SSMClient, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';

const cognito = new CognitoIdentityProviderClient({});
const ssm = new SSMClient({});

interface ResourceProperties {
  UserPoolId: string;
  Email: string;
  EmailSsmPath: string;
  PasswordSsmPath: string;
}

// Cognito default password policy requires upper/lower/digit/symbol. A raw
// base64 password from randomBytes can fail that policy by chance (e.g. all
// alphanumeric), so prefix with one of each required class to guarantee it.
function generatePassword(): string {
  return `Ac1!${randomBytes(24).toString('base64').replace(/[+/=]/g, '')}`;
}

async function putParameters(props: ResourceProperties, password: string) {
  await ssm.send(new PutParameterCommand({
    Name: props.EmailSsmPath,
    Value: props.Email,
    Type: 'String',
    Overwrite: true,
  }));
  await ssm.send(new PutParameterCommand({
    Name: props.PasswordSsmPath,
    Value: password,
    Type: 'SecureString',
    Overwrite: true,
  }));
}

async function deleteParameters(props: ResourceProperties) {
  for (const name of [props.EmailSsmPath, props.PasswordSsmPath]) {
    try {
      await ssm.send(new DeleteParameterCommand({ Name: name }));
    } catch (err) {
      if ((err as { name?: string }).name !== 'ParameterNotFound') throw err;
    }
  }
}

async function userExists(userPoolId: string, username: string): Promise<boolean> {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return false;
    throw err;
  }
}

export const handler = async (
  event: CdkCustomResourceEvent,
): Promise<CdkCustomResourceResponse> => {
  const props = event.ResourceProperties as unknown as ResourceProperties;

  if (event.RequestType === 'Create' || event.RequestType === 'Update') {
    const password = generatePassword();

    // This user pool's UsernameAttributes includes "email", so Cognito always
    // auto-generates a UUID as the real Username — it ignores any Username
    // passed to AdminCreateUser and stores our value only in the `email`
    // attribute. Admin* APIs (unlike sign-in) require that generated UUID,
    // not the email, so it must be captured from the create response and
    // carried forward via PhysicalResourceId for Update/Delete events.
    //
    // On Update, re-verify the carried-forward username still resolves
    // before reusing it — a prior deploy of an earlier handler version can
    // leave PhysicalResourceId pointing at a username that was never
    // actually created (or has since been deleted out-of-band), and
    // AdminSetUserPassword against a nonexistent username always fails.
    let username: string | undefined =
      event.RequestType === 'Update' && (await userExists(props.UserPoolId, event.PhysicalResourceId))
        ? event.PhysicalResourceId
        : undefined;

    if (!username) {
      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: props.UserPoolId,
        // Ignored by Cognito for pools with `email` in UsernameAttributes
        // (it auto-generates a UUID instead) but the SDK type requires it.
        Username: props.Email,
        UserAttributes: [
          { Name: 'email', Value: props.Email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }));
      username = created.User?.Username;
      if (!username) throw new Error('AdminCreateUser did not return a Username');
    }

    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: props.UserPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }));

    await putParameters(props, password);

    return { PhysicalResourceId: username };
  }

  // event.RequestType === 'Delete'
  try {
    await cognito.send(new AdminDeleteUserCommand({
      UserPoolId: props.UserPoolId,
      Username: event.PhysicalResourceId,
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== 'UserNotFoundException') throw err;
  }
  await deleteParameters(props);
  return { PhysicalResourceId: event.PhysicalResourceId };
};
