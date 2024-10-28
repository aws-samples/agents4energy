import { RDSDataClient, ExecuteStatementCommand, ExecuteStatementCommandInput } from "@aws-sdk/client-rds-data";
import * as fs from 'fs';
import * as path from 'path';

const client = new RDSDataClient();

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  // Read the SQL file
  const sqlFilePath = path.join(__dirname, 'prod_create_table_and_data.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

  // Split the SQL content into individual statements
  const sqlStatements = sqlContent.split(';').filter(stmt => stmt.trim() !== '');

  for (const sql of sqlStatements) {
    const params: ExecuteStatementCommandInput = {
      resourceArn: process.env.CLUSTER_ARN,
      secretArn: process.env.SECRET_ARN,
      database: process.env.DATABASE_NAME,
      sql: sql.trim(),
    };

    const command = new ExecuteStatementCommand(params);

    try {
      const result = await client.send(command);
      console.log('SQL execution successful:', result);
    } catch (error) {
      console.error('Error executing SQL:', error);
      throw error;
    }
  }

  return { statusCode: 200, body: 'All SQL statements executed successfully' };
};