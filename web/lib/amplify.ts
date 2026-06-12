import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

let configured = false;

export function configureAmplify() {
  if (configured) return;
  configured = true;
  Amplify.configure(outputs);
}
