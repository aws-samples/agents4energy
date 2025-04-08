// This script verifies that the structured data setup is working correctly

const AWS = require('aws-sdk');
const glue = new AWS.Glue();
const athena = new AWS.Athena();
const s3 = new AWS.S3();
const cloudformation = new AWS.CloudFormation();

// Constants
const DATABASE_NAME = 'agents4energy_db';
const WORKGROUP_NAME = 'agents4energy-workgroup';
const STACK_NAME = process.env.STACK_NAME || 'amplify-agentsforenergy-cm';

async function getBucketNameFromStack() {
  try {
    // Get the stack resources
    const resources = await cloudformation.listStackResources({ StackName: STACK_NAME }).promise();
    
    // Find the file drive bucket resource
    const bucketResource = resources.StackResourceSummaries.find(
      resource => resource.LogicalResourceId.includes('filedrivebucket')
    );
    
    if (bucketResource) {
      return bucketResource.PhysicalResourceId;
    } else {
      console.log('❌ Could not find file drive bucket in stack resources');
      return process.env.BUCKET_NAME || 'amplify-agentsforenergy-cm-filedrivebucket01be03e1-tgbpipx2uu7y';
    }
  } catch (error) {
    console.error('Error getting bucket name from stack:', error);
    return process.env.BUCKET_NAME || 'amplify-agentsforenergy-cm-filedrivebucket01be03e1-tgbpipx2uu7y';
  }
}

async function verifySetup() {
  console.log('Verifying Agents4Energy structured data setup...');
  
  // Get the bucket name
  const BUCKET_NAME = await getBucketNameFromStack();
  console.log(`Using bucket: ${BUCKET_NAME}`);
  
  // Check if the database exists
  try {
    const databases = await glue.getDatabases().promise();
    const agentsDb = databases.DatabaseList?.find(db => db.Name === DATABASE_NAME);
    
    if (agentsDb) {
      console.log('✅ Glue database exists');
      
      // Check tables
      const tables = await glue.getTables({ DatabaseName: DATABASE_NAME }).promise();
      console.log(`Found ${tables.TableList?.length || 0} tables in the database`);
      
      tables.TableList?.forEach(table => {
        console.log(`- ${table.Name}`);
      });
    } else {
      console.log('❌ Glue database not found');
    }
  } catch (error) {
    console.error('Error checking Glue database:', error);
  }
  
  // Test a simple Athena query
  try {
    const queryExecutionId = await athena.startQueryExecution({
      QueryString: `SELECT * FROM ${DATABASE_NAME}.compliance_reports LIMIT 10`,
      QueryExecutionContext: {
        Database: DATABASE_NAME
      },
      ResultConfiguration: {
        OutputLocation: `s3://${BUCKET_NAME}/athena-results/`
      },
      WorkGroup: WORKGROUP_NAME
    }).promise();
    
    console.log('✅ Athena query started:', queryExecutionId);
    
    // Wait for the query to complete
    let queryStatus = 'RUNNING';
    while (queryStatus === 'RUNNING' || queryStatus === 'QUEUED') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const queryExecution = await athena.getQueryExecution({ QueryExecutionId: queryExecutionId.QueryExecutionId }).promise();
      queryStatus = queryExecution.QueryExecution.Status.State;
    }
    
    if (queryStatus === 'SUCCEEDED') {
      console.log('✅ Athena query succeeded');
      
      // Get the results
      const results = await athena.getQueryResults({ QueryExecutionId: queryExecutionId.QueryExecutionId }).promise();
      console.log(`Found ${results.ResultSet.Rows.length - 1} rows`);
    } else {
      console.log(`❌ Athena query failed with status: ${queryStatus}`);
    }
  } catch (error) {
    console.error('❌ Error running Athena query:', error);
  }
  
  // Check S3 bucket contents
  try {
    const agentTypes = [
      'production',
      'regulatory',
      'drilling',
      'petrophysics',
      'finance',
      'land',
      'refining',
      'trading',
      'logistics',
      'decarb'
    ];
    
    for (const agentType of agentTypes) {
      const prefix = `${agentType}-agent/structured-data-files/`;
      const agentObjects = await s3.listObjectsV2({ Bucket: BUCKET_NAME, Prefix: prefix }).promise();
      
      if (agentObjects.Contents?.length) {
        console.log(`✅ Found ${agentObjects.Contents.length} objects for ${agentType} agent`);
      } else {
        console.log(`❌ No data found for ${agentType} agent`);
      }
    }
  } catch (error) {
    console.error('Error checking S3 bucket:', error);
  }
}

verifySetup().catch(console.error);
