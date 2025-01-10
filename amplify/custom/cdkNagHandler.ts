// import { Stack } from 'aws-cdk-lib'
// //These are for testing
// import { AwsSolutionsChecks } from 'cdk-nag'
// import { NagSuppressions } from 'cdk-nag'
// import { Aspects } from 'aws-cdk-lib';

// export function cdkNagHandler(stack: Stack) {

//     NagSuppressions.addStackSuppressions(stack, [
//         {
//           id: 'AwsSolutions-IAM4',
//           reason: 'The lambda execution role must be able to dynamically create log groups, and so will have a * in the iam policy resource section'
//         },
//       ])
      
//       NagSuppressions.addStackSuppressions(stack, [
//         {
//           id: 'AwsSolutions-IAM5',
//           reason: 'The Lambda function must be able to get any object from the well file drive bucket, so a * in needed in the resource arn.'
//         },
//       ])
      
//       NagSuppressions.addStackSuppressions(stack, [
//         {
//           id: 'AwsSolutions-L1',
//           reason: `This lambda is created by s3Deployment from 'aws-cdk-lib/aws-s3-deployment'`
//         },
//       ])
      
//       // Use cdk-nag on the root stack
//       Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))

// }