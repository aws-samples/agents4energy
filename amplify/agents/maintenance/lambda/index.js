const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
const rdsDataClient = new RDSDataClient();

const fs = require('fs');

// Read SQL commands from files
const sqlCommands = [
    // Provide list of .sql files in the correct order to run against CMMS database
    fs.readFileSync('./createCMMSTableEquipmentTypes.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableLocationTypes.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableMaintTypes.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableStatusTypes.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableBusinessUnits.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableLocations.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableEquipment.sql', 'utf8'),
    fs.readFileSync('./createCMMSTableMaintenance.sql', 'utf8'),
    fs.readFileSync('./createCMMSKeyEquipment-Type.sql', 'utf8'),
    fs.readFileSync('./createCMMSKeyEquipment-Location.sql', 'utf8'),

    fs.readFileSync('./deleteCMMSDataMaintenance.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataEquipment.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataLocations.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataBusinessUnits.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataStatusTypes.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataMaintTypes.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataLocationTypes.sql', 'utf8'),
    fs.readFileSync('./deleteCMMSDataEquipmentTypes.sql', 'utf8'),

    fs.readFileSync('./insertCMMSDataEquipmentTypes.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataLocationTypes.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataMaintTypes.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataStatusTypes.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataBusinessUnits.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataLocations.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataEquipment.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataMaintenanceDS.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataMaintenanceMS.sql', 'utf8'),
    fs.readFileSync('./insertCMMSDataMaintenanceINS.sql', 'utf8'),
];

exports.handler = async (event) => {
    try {
        const { MAINT_DB_CLUSTER_ARN, MAINT_DB_SECRET_ARN, DEFAULT_DATABASE_NAME } = process.env;

        if (!MAINT_DB_CLUSTER_ARN || !MAINT_DB_SECRET_ARN || !DEFAULT_DATABASE_NAME) {
            throw new Error('Missing required environment variables');
        }

        const results = [];
        for (const sqlCommand of sqlCommands) {
            const params = {
                resourceArn: MAINT_DB_CLUSTER_ARN,
                secretArn: MAINT_DB_SECRET_ARN,
                database: DEFAULT_DATABASE_NAME,
                sql: sqlCommand
            };

            console.log('Executing SQL command:', sqlCommand);

            const command = new ExecuteStatementCommand(params);
            try {
                const result = await rdsDataClient.send(command);
                results.push({
                    sql: sqlCommand,
                    status: 'success',
                    result
                });
            } catch (error) {
                console.error('Error executing SQL command:', error);
                results.push({
                    sql: sqlCommand,
                    status: 'error',
                    error: error.message
                });
                // Continue with next command even if one fails
            }
        }

        // Check if any commands failed
        const failedCommands = results.filter(r => r.status === 'error');
        if (failedCommands.length > 0) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    message: 'Some SQL commands failed to execute',
                    results
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'All SQL commands executed successfully',
                results
            })
        };

    } catch (error) {
        console.error('Lambda execution error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Lambda execution failed',
                error: error.message
            })
        };
    }
};