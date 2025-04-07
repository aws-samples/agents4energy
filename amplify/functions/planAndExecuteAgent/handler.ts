import { AppSyncResolverHandler } from 'aws-lambda';
import './types';

export const handler: AppSyncResolverHandler<any, any> = async (event, context, callback) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    // Import the actual handler dynamically
    const { handler: actualHandler } = await import('./index');
    const result = await actualHandler(event, context, callback);
    return result;
  } catch (error) {
    console.error('Error in handler:', error);
    return {
      error: 'An error occurred while processing your request',
      details: error instanceof Error ? error.message : String(error)
    };
  }
};
