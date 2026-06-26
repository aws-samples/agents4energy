import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface HostingStackProps extends StackProps {
  /** Branch name used only for tagging; the stack id/name is set by the caller. */
  branch?: string;
}

/**
 * Shared static hosting: one S3 bucket + one CloudFront distribution.
 * All branch content lives under per-branch prefixes: s3://bucket/{branch}/
 * Deployed URL per branch: https://{domain}/{branch}/
 *
 * Deploy once per branch; reused by every rebuild and local sandbox deploys.
 * Instantiate via cdk.ts using the `stackName` CDK context key.
 */
export class HostingStack extends Stack {
  constructor(scope: Construct, id: string, props?: HostingStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'HostingBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `AgentCore CLI hosting OAI (${this.stackName})`,
    });

    bucket.grantRead(oai);

    // Route extensionless paths to per-route HTML files; fall back to index.html
    // for branch root. URI structure: /{branch}/[page]
    const spaRouter = new cloudfront.Function(this, 'SpaRouter', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var uri = event.request.uri;
  if (/\\.[^\\/]+$/.test(uri)) return event.request;
  var parts = uri.split("/").filter(function(s) { return s !== ""; });
  var branch = parts.length > 0 ? parts[0] : "main";
  if (parts.length <= 1) {
    event.request.uri = "/" + branch + "/index.html";
  } else {
    event.request.uri = "/" + parts.join("/") + ".html";
  }
  return event.request;
}
      `.trim()),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Route extensionless paths to per-route HTML files; fall back to index.html for branch root',
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: spaRouter,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // Amplify app used by `ampx pipeline-deploy` in CI. A branch resource is
    // required so the BranchLinker custom resource in pipeline-deploy succeeds.
    const amplifyApp = new amplify.CfnApp(this, 'AmplifyApp', {
      name: this.stackName,
    });

    const branch = props?.branch ?? 'main';
    new amplify.CfnBranch(this, 'AmplifyBranch', {
      appId: amplifyApp.attrAppId,
      branchName: branch,
    });

    new CfnOutput(this, 'AmplifyAppId', {
      description: 'Amplify app ID — pass to ampx pipeline-deploy --app-id',
      value: amplifyApp.attrAppId,
    });

    new CfnOutput(this, 'BucketName', {
      description: 'S3 bucket that holds all branch deployments',
      value: bucket.bucketName,
    });

    new CfnOutput(this, 'DistributionId', {
      description: 'CloudFront distribution ID (for cache invalidation)',
      value: distribution.distributionId,
    });

    new CfnOutput(this, 'Domain', {
      description: 'CloudFront domain name (e.g. abc123.cloudfront.net)',
      value: distribution.distributionDomainName,
    });
  }
}
