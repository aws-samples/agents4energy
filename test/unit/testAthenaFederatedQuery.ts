import { getDeployedResourceArn, getLambdaEnvironmentVariables } from "../utils";
import { executeSQLQueryTool } from '../../amplify/functions/productionAgentFunction/toolBox';
import outputs from '@/../amplify_outputs.json';

async function main() {
    const rootStackName = outputs.custom.root_stack_name
    await getLambdaEnvironmentVariables(await getDeployedResourceArn(rootStackName, 'productionagentfunctionlambda'))

    // console.log('ATHENA_WORKGROUP_NAME: ', process.env.ATHENA_WORKGROUP_NAME)

    const tableDefinitions = await executeSQLQueryTool.invoke({
        query: /* sql */ ` 
            SELECT 
            oil ,
            gas , 
            water 
            FROM production.daily
            WHERE proddate >= date_add('week', -12, current_date)`,


        // query: /* sql */ `
        //     DESCRIBE public.locations
        // `,

        // query: /* sql */ `
        //     SELECT schema_name 
        //     FROM information_schema.schemata;
        // `,
        database: "public"
    });
    console.log('result:\n', tableDefinitions);
}

main()