import type { NextConfig } from "next";

// Static export is uploaded to s3://<bucket>/<branch-slug>/ and served from
// that sub-path (see web/amplify/constructs/hostingConstruct.ts) — basePath
// makes Next.js emit /<branch-slug>/... for every asset, route, and redirect
// instead of absolute root paths that would 404 once behind the CDN prefix.
const basePath = process.env.NEXT_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
};

export default nextConfig;
