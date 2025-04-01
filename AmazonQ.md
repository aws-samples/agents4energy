# Agents4Energy Dependency and Build Configuration

## Identified Issues

1. **Node.js Version Incompatibility**
   - Some packages require Node.js v20+ or v22+
   - Build environment was using Node.js v18.20.6
   - Affected packages: path-scurry@2.0.0, minimatch@10.0.1

2. **Missing Build Script**
   - The build process was trying to run `npm run build:backend`
   - This script doesn't exist in package.json

3. **Package Access Issues**
   - 403 Forbidden errors when trying to download npm packages
   - Specifically for camelcase@6.3.0 and camel-case@4.1.2

4. **AWS Amplify Deprecation Warnings**
   - Multiple @aws-amplify/* packages showed deprecation warnings
   - Message: "backend-cli 1.6.0 does not work with Amplify Hosting service"

## Applied Solutions

1. **Node.js Version Configuration**
   - Added `.nvmrc` file to specify Node.js v20.9.0
   - Updated `amplify.yml` to use Node.js v20 in the build environment
   - Added `engines` field to package.json to specify Node.js >=20.0.0

2. **Amplify CLI Version Update**
   - Updated @aws-amplify/backend from 1.13.0 to 1.15.0
   - Updated @aws-amplify/backend-cli from 1.4.7 to 1.6.0
   - These versions align with the current Amplify Hosting service requirements

3. **Build Process Improvements**
   - Modified `amplify.yml` to skip the non-existent backend build script
   - Added pre-installation of problematic packages
   - Configured npm with retry settings and disabled strict SSL
   - Used `--legacy-peer-deps` flag to handle dependency conflicts

4. **Memory Configuration**
   - Added NODE_OPTIONS to increase available memory for build processes

## Best Practices for Dependency Management

1. **Version Pinning**
   - Use exact versions for critical dependencies
   - Consider using package locks for consistent installations

2. **Regular Updates**
   - Run `npm audit` regularly to check for vulnerabilities
   - Use `npm update` to keep dependencies current
   - Consider automated dependency updates with tools like Dependabot

3. **Build Environment Consistency**
   - Use `.nvmrc` or similar to specify Node.js version
   - Document environment requirements in README
   - Consider containerization for complete environment control

4. **Amplify-Specific Recommendations**
   - Keep Amplify CLI versions aligned with Amplify Hosting requirements
   - Test locally before deploying to catch compatibility issues
   - Review Amplify documentation for version compatibility guidance

## References
- [AWS Amplify Documentation](https://docs.aws.amazon.com/amplify/)
- [Node.js Release Schedule](https://nodejs.org/en/about/releases/)
- [npm Documentation](https://docs.npmjs.com/)
- [AWS Amplify Troubleshooting Guide](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-ssr-deployment.html)
