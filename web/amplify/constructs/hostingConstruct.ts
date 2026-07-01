import { RemovalPolicy } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * S3 + CloudFront static hosting construct.
 * All branch content lives under per-branch prefixes: s3://bucket/{branch}/
 * Deployed URL per branch: https://{domain}/{branch}/
 */
export class HostingConstruct extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'HostingBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `AgentCore hosting OAI`,
    });

    this.bucket.grantRead(oai);

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
      comment: 'Route extensionless paths to per-route HTML files',
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
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

    this.distributionDomainName = this.distribution.distributionDomainName;
  }
}
