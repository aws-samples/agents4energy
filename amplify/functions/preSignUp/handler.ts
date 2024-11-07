import type { PreSignUpTriggerHandler } from 'aws-lambda';
import { env } from '$amplify/env/preSignUp'; // replace with your function name

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes['email'];

  const allowedEmailDomainSuffixes = (env.ALLOWED_EMAIL_DOMAIN_SUFFIXES).split(",")

  for (const domainSuffix of allowedEmailDomainSuffixes) {
    if (email.endsWith(domainSuffix)) {
      return event;
    }
  }
  
  throw new Error(`Invalid email domain. Email address ${event.request.userAttributes['email']} does not end with an allowed domain: ${allowedEmailDomainSuffixes}`);
};