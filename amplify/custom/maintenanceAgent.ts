
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import { Stack, Fn, Aws, Token } from 'aws-cdk-lib';
import {
    aws_bedrock as bedrock,
    aws_iam as iam,
    aws_s3 as s3,
    aws_rds as rds,
    aws_lambda as lambda,
    aws_ec2 as ec2,
    custom_resources as cr
} from 'aws-cdk-lib';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addLlmAgentPolicies } from '../functions/utils/cdkUtils'

interface AgentProps {
    vpc: ec2.Vpc,
    s3Bucket: s3.IBucket,
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment
}

export function maintenanceAgentBuilder(scope: Construct, props: AgentProps) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const stackName = cdk.Stack.of(scope).stackName;
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    const defaultDatabaseName = 'maintdb';
    const foundationModel = 'anthropic.claude-3-sonnet-20240229-v1:0';
    const agentName = `A4E-Maintenance-${stackUUID}`;
    const agentRoleName = 'AmazonBedrockExecutionRole_A4E_Maintenance';
    const agentDescription = 'Agent for energy industry maintenance workflows';
    const knowledgeBaseName = `A4E-KB-Maintenance-${stackUUID}`;
    const postgresPort = 5432;
    const maxLength = 4096;

    console.log("Maintenance Stack UUID: ", stackUUID)

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    // Agent-specific tags
    const maintTags = {
        Agent: 'Maintenance',
        Model: foundationModel
    }


    const bedrockAgentRole = new iam.Role(scope, 'BedrockAgentRole', {
        //roleName: agentRoleName,
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        description: 'IAM role for Maintenance Agent to access KBs and query CMMS',
    });

    // ===== CMMS Database =====
    // Create Aurora PostgreSQL DB for CMMS - https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.DatabaseCluster.html
    const maintDb = new rds.DatabaseCluster(scope, 'MaintDB', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        defaultDatabaseName: defaultDatabaseName,
        enableDataApi: true,
        writer: rds.ClusterInstance.serverlessV2('writer'),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 4,
        vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        vpc: props.vpc,
        port: postgresPort,
        removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const writerNode = maintDb.node.findChild('writer').node.defaultChild as rds.CfnDBInstance // Set this as a dependency to cause a resource to wait until the database is queriable

    //Allow inbound traffic from the default SG in the VPC
    maintDb.connections.securityGroups[0].addIngressRule(
        ec2.Peer.securityGroupId(props.vpc.vpcDefaultSecurityGroup),
        ec2.Port.tcp(postgresPort),
        'Allow inbound traffic from default SG'
    );
    // Create a Lambda function that runs SQL statements to prepare the postgres cluster with sample data
    const prepDbFunction = new lambda.Function(scope, `PrepDbFunction`, {
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        timeout: cdk.Duration.minutes(15),
        code: lambda.Code.fromInline(`
          const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
          const rdsDataClient = new RDSDataClient();

          exports.handler = async () => {
              const sqlCommands = [
                /* sql */ \`
                CREATE TABLE IF NOT EXISTS EquipmentTypes (
                EquipTypeID int NOT NULL
                , EquipTypeName varchar(100) NOT NULL
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT equipmenttypes_pkey PRIMARY KEY (equiptypeid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS LocationTypes (
                LocTypeID varchar(3) NOT NULL
                , LocTypeName varchar(100) NOT NULL
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT locationtypes_pkey PRIMARY KEY (loctypeid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS MaintTypes (
                MaintTypeID varchar(3) NOT NULL
                , MaintTypeName varchar(100) NOT NULL
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT mainttypes_pkey PRIMARY KEY (mainttypeid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS StatusTypes (
                StatusID varchar(3) NOT NULL
                , StatusName varchar(100) NOT NULL
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT statustypes_pkey PRIMARY KEY (statusid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS BusinessUnits (
                BUID varchar(3) NOT NULL
                , BUName varchar(100) NOT NULL
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT businessunits_pkey PRIMARY KEY (buid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS Locations (
                LocationID int NOT NULL
                , LocTypeID varchar(3) NOT NULL REFERENCES LocationTypes(LocTypeID)
                , LocName varchar(100) NOT NULL
                , BusinessUnit varchar(3) REFERENCES businessunits(buid)
                , Facility int REFERENCES locations(locationid)
                , Section varchar(20)
                , WorkCenter varchar(20)
                , LocMgrID varchar(20)
                , Latitude float
                , Longitude float
                , Address1 varchar(100)
                , Address2 varchar(100)
                , City varchar(100)
                , State varchar(100)
                , Zip varchar(20)
                , Country varchar(100)
                , Phone varchar(20)
                , Fax varchar(20)
                , Email varchar(100)
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT locations_pkey PRIMARY KEY (locationid)
                );
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS Equipment (
                EquipID varchar(20) NOT NULL
                , EquipTypeID int NOT NULL
                , EquipName varchar(100) NOT NULL
                , EquipLongDesc varchar(250)
                , Manufacturer varchar(50)
                , Model varchar(50)
                , ManfYear int
                , WebLink varchar(250)
                , SerialNum varchar(50)
                , EquipWeight decimal(10,2)
                , InstallLocationID int
                , lat decimal(10,6)
                , lon decimal(10,6)
                , SafetyCritical boolean NOT NULL
                , StatusID varchar(3) NOT NULL
                , ServiceDateStart date
                , ServiceDateEnd date
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT equipment_pkey PRIMARY KEY (equipid)
                );
                                \`, /* sql */ \`
                                DO \$\$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM   information_schema.table_constraints
                        WHERE  table_schema = 'public'  -- Adjust schema name if necessary
                        AND   table_name   = 'equipment'
                        AND   constraint_name = 'installlocationid_fk'
                    ) THEN
                        ALTER TABLE equipment
                        ADD CONSTRAINT equipmenttypeid_fk FOREIGN KEY (equiptypeid)
                        REFERENCES equipmenttypes (equiptypeid) MATCH SIMPLE
                        ON UPDATE NO ACTION
                        ON DELETE NO ACTION
                        NOT VALID;
                    END IF;
                END \$\$;
                                \`, /* sql */ \`
                                DO \$\$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM   information_schema.table_constraints
                        WHERE  table_schema = 'public'  -- Adjust schema name if necessary
                        AND   table_name   = 'equipment'
                        AND   constraint_name = 'installlocationid_fk'
                    ) THEN
                        ALTER TABLE equipment
                        ADD CONSTRAINT installlocationid_fk FOREIGN KEY (installlocationid)
                        REFERENCES locations (locationid) MATCH SIMPLE
                        ON UPDATE NO ACTION
                        ON DELETE NO ACTION
                        NOT VALID;
                    END IF;
                END \$\$;
                                \`, /* sql */ \`
                                CREATE TABLE IF NOT EXISTS Maintenance (
                MaintID int NOT NULL
                , MaintTypeID varchar(3) NOT NULL REFERENCES mainttypes(mainttypeid)
                , EquipID varchar(20)
                , MaintName varchar(100) NOT NULL
                , MaintLongDesc varchar(250)
                , WorkOrderID varchar(20)
                , EffortHours int
                , EstCost numeric(10,2)
                , DowntimeReq boolean
                , TechnicianID varchar(50)
                , ResponsibleID varchar(50)
                , RequiresPermit boolean
                , StatusID varchar(3) NOT NULL REFERENCES statustypes(statusid)
                , PlannedDateStart date
                , PlannedDateEnd date
                , ActualDateStart date
                , ActualDateEnd date
                , CreatedBy varchar(50) DEFAULT 'AWS'
                , CreatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , UpdatedBy varchar(50) DEFAULT 'AWS'
                , UpdatedDate timestamp DEFAULT CURRENT_TIMESTAMP
                , CONSTRAINT maintenance_pkey PRIMARY KEY (maintid)
                );
                \`, /* sql */ \`
                DELETE FROM maintenance;
                \`, /* sql */ \`
                DELETE FROM equipment;
                \`, /* sql */ \`
                DELETE FROM locations;
                \`, /* sql */ \`
                DELETE FROM businessunits;
                \`, /* sql */ \`
                DELETE FROM statustypes;
                \`, /* sql */ \`
                DELETE FROM mainttypes;
                \`, /* sql */ \`
                DELETE FROM locationtypes;
                \`, /* sql */ \`
                DELETE FROM equipmenttypes;
                \`, /* sql */ \`
                INSERT INTO equipmenttypes (equiptypeid, equiptypename) VALUES
                (1, 'Atmospheric Distillation Tower'),
                (2, 'Storage Tank'),
                (3, 'Heat Exchanger'),
                (4, 'Vacuum Distillation Tower'),
                (5, 'Air Cooler'),
                (6, 'Evaporator'),
                (7, 'Crude Oil Pump'),
                (8, 'Furnace'),
                (9, 'Hydrotreater'),
                (10, 'Hydrocracker'),
                (11, 'Coker'),
                (12, 'Catalytic Cracker'),
                (13, 'Reactor'),
                (14, 'Compressors'),
                (15, 'Horizontal Tank'),
                (16, 'Vertical Tank'),
                (17, 'Equipment Skid'),
                (18, 'Tanker Truck'),
                (20, 'Shipping Container'),
                (21, 'Desalter'),
                (22, 'Valve'),
                (23, 'Separator'),
                (24, 'Fractionator'),
                (25, 'Conveyor'),
                (51, 'Pig Trap'),
                (52, 'Compressor Station'),
                (53, 'Rectifier'),
                (54, 'Anode'),
                (55, 'Voltmeter'),
                (26, 'Wellhead and Christmas Tree'),
                (27, 'Pump Jack'),
                (28, 'Well Site Storage Tank'),
                (29, 'Separator'),
                (30, 'Heater Treater'),
                (31, 'Well Site Compressor'),
                (32, 'Remote Terminal Unit'),
                (33, 'Well Site Meter'),
                (34, 'Flare Stack'),
                (35, 'Well Site Electrical Equipment'),
                (36, 'Chemical Injection Skid'),
                (37, 'Well Site Piping and Valves'),
                (38, 'LACT Unit')
                ;
                \`, /* sql */ \`
                INSERT INTO MaintTypes (MaintTypeID,MaintTypeName) VALUES
                ('CM','Corrective Maintenance'),
                ('PM','Preventative Maintenance')
                ;
                                \`, /* sql */ \`
                                INSERT INTO locationtypes (loctypeid, loctypename) VALUES
                ('FCL', 'Facility'),
                ('UNT', 'Unit'),
                ('OTH', 'Other'),
                ('WPD', 'Wellpad'),
                ('WEL', 'Well')
                ;
                \`, /* sql */ \`
                INSERT INTO statustypes (statusid, statusname) VALUES
                ('NEW', 'New'),
                ('ASG', 'Assigned'),
                ('INP', 'In Progress'),
                ('BLK', 'Blocked'),
                ('COM', 'Complete'),
                ('VFD', 'Verified'),
                ('ACT', 'Active'),
                ('DCM', 'Decommissioned'),
                ('EXP', 'Inactive')
                ;
                \`, /* sql */ \`
                INSERT INTO businessunits (buid, buname) VALUES
                ('R', 'Refineries'),
                ('C', 'Petrochemicals'),
                ('T', 'Trading & Forecasting'),
                ('L', 'LNG Facilities'),
                ('P', 'Pipelines'),
                ('U', 'Upstream')
                ;
                \`, /* sql */ \`
                INSERT INTO locations (locationid, loctypeid, locname, businessunit, facility, section, workcenter, locmgrid, latitude, longitude, address1, address2, city, state, zip, country, phone, fax, email) VALUES
                (701,'FCL','Gladstone Plant','P',NULL,'ANZ','QLD','5',-23.918903,151.337142,'Handley Drive','','Boyne Island','','4680','AUS','','',''),
                (702,'FCL','Dalby','P',NULL,'ANZ','QLD','5',-27.185334,151.203374,'','','','','','','','',''),
                (703,'FCL','Chinchilla','P',NULL,'ANZ','QLD','5',-26.989455,150.449455,'','','','','','','','',''),
                (704,'FCL','Wallumbilla','P',NULL,'ANZ','QLD','5',-26.692543,149.188419,'','','','','','','','',''),
                (705,'FCL','Myall','P',NULL,'ANZ','QLD','5',-26.05396,148.854601,'','','','','','','','',''),
                (706,'FCL','Bauhina','P',NULL,'ANZ','QLD','5',-24.591063,149.296095,'','','','','','','','',''),
                (707,'FCL','Callide','P',NULL,'ANZ','QLD','5',-24.286205,150.438059,'','','','','','','','',''),
                (708,'FCL','Yellowbank North','P',NULL,'ANZ','QLD','5',-25.450835,148.631184,'','','','','','','','',''),
                (928,'FCL','Sandy Point Refinery','R',NULL,'','','3',29.598392,-95.01286,'12222 Port Rd','','Pasadena','TX','77507','United States','832-555-1234','','info@sandypointrefinery.com'),
                (930,'UNT','Hydrotreating','R',928,'','','3',29.599827,-95.012267,'','','','','','','','',''),
                (934,'UNT','Biodiesel Unit','R',928,'','','3',29.5988503333333,-95.0144043333333,'','','','','','','','',''),
                (929,'UNT','Distillation','R',928,'','','3',29.601715,-95.011649,'','','','','','','','',''),
                (931,'UNT','Cracking','R',928,'','','3',29.5996315,-95.011965,'','','','','','','','',''),
                (933,'UNT','Refined Product Storage','R',928,'','','3',29.5999835,-95.01411825,'','','','','','','','',''),
                (935,'UNT','Coking Unit','R',928,'','','3',29.598308,-95.011206,'','','','','','','','',''),
                (932,'UNT','Other Equipment','R',928,'','','3',NULL,NULL,'','','','','','','','',''),
                (936,'WPD','Iron Horse','U',NULL,'West','','',31.9686,-102.0757,'','','','','','','','',''),
                (937,'WPD','Dire Wolf','U',NULL,'West','','',32.0322,-102.1231,'','','','','','','','',''),
                (938,'WPD','Maverick','U',NULL,'West','','',31.9054,-102.0612,'','','','','','','','',''),
                (939,'WPD','Sidewinder','U',NULL,'West','','',32.0928,-102.1105,'','','','','','','','',''),
                (940,'WPD','Thunderhawk','U',NULL,'West','','',31.8419,-101.9939,'','','','','','','','',''),
                (941,'WPD','Diamondback','U',NULL,'East','','',32.2456,-101.5231,'','','','','','','','',''),
                (942,'WPD','Copperhead','U',NULL,'East','','',32.1822,-101.4758,'','','','','','','','',''),
                (943,'WPD','Bushmaster','U',NULL,'East','','',32.3093,-101.6305,'','','','','','','','',''),
                (944,'WPD','Rattlesnake','U',NULL,'East','','',32.0489,-101.3684,'','','','','','','','',''),
                (945,'WPD','Black Mamba','U',NULL,'East','','',32.2917,-101.5806,'','','','','','','','',''),
                (946,'WEL','Iron Horse 1','U',936,'','','',31.9707459142601,-102.070722825017,'','','','','','','','',''),
                (947,'WEL','Iron Horse 2','U',936,'','','',31.9682015418363,-102.078143730322,'','','','','','','','',''),
                (948,'WEL','Iron Horse 3','U',936,'','','',31.9715937530547,-102.077970937297,'','','','','','','','',''),
                (949,'WEL','Iron Horse 4','U',936,'','','',31.9665803013098,-102.079990717897,'','','','','','','','',''),
                (950,'WEL','Iron Horse 5','U',936,'','','',31.9691238230059,-102.080051382403,'','','','','','','','',''),
                (951,'WEL','Dire Wolf 1','U',937,'','','',32.0360764072043,-102.121710264032,'','','','','','','','',''),
                (952,'WEL','Dire Wolf 2','U',937,'','','',32.0285340450142,-102.123263837431,'','','','','','','','',''),
                (953,'WEL','Dire Wolf 3','U',937,'','','',32.0294977499398,-102.120420468415,'','','','','','','','',''),
                (954,'WEL','Maverick 1','U',938,'','','',31.9041133590173,-102.065221560316,'','','','','','','','',''),
                (955,'WEL','Maverick 2','U',938,'','','',31.9041571635625,-102.065733593417,'','','','','','','','',''),
                (956,'WEL','Sidewinder 1','U',939,'','','',32.0974174131576,-102.106434534204,'','','','','','','','',''),
                (957,'WEL','Sidewinder 2','U',939,'','','',32.0918738999685,-102.111342835686,'','','','','','','','',''),
                (958,'WEL','Sidewinder 3','U',939,'','','',32.0953309615961,-102.105594045687,'','','','','','','','',''),
                (959,'WEL','Sidewinder 4','U',939,'','','',32.0934911474149,-102.110242853871,'','','','','','','','',''),
                (960,'WEL','Sidewinder 5','U',939,'','','',32.0943257921752,-102.11312985197,'','','','','','','','',''),
                (961,'WEL','Sidewinder 6','U',939,'','','',32.0963180948506,-102.111312317382,'','','','','','','','',''),
                (962,'WEL','Sidewinder 7','U',939,'','','',32.0919707605628,-102.113465906211,'','','','','','','','',''),
                (963,'WEL','Thunderhawk 1','U',940,'','','',31.8419732702181,-101.992266445376,'','','','','','','','',''),
                (964,'WEL','Thunderhawk 2','U',940,'','','',31.8451744592327,-101.989412528863,'','','','','','','','',''),
                (965,'WEL','Thunderhawk 3','U',940,'','','',31.8399372178563,-101.995950681111,'','','','','','','','',''),
                (966,'WEL','Thunderhawk 4','U',940,'','','',31.8423540882725,-101.99119685791,'','','','','','','','',''),
                (967,'WEL','Diamondback 1','U',941,'','','',32.2486705430822,-101.521360091358,'','','','','','','','',''),
                (968,'WEL','Copperhead 1','U',942,'','','',32.1800453611805,-101.474763054096,'','','','','','','','',''),
                (969,'WEL','Copperhead 2','U',942,'','','',32.1781277065871,-101.47306834048,'','','','','','','','',''),
                (970,'WEL','Copperhead 3','U',942,'','','',32.1861231631566,-101.48040150064,'','','','','','','','',''),
                (971,'WEL','Copperhead 4','U',942,'','','',32.1803637130584,-101.480739461054,'','','','','','','','',''),
                (972,'WEL','Copperhead 5','U',942,'','','',32.1775228225165,-101.473343292276,'','','','','','','','',''),
                (973,'WEL','Copperhead 6','U',942,'','','',32.1851122730724,-101.47304817434,'','','','','','','','',''),
                (974,'WEL','Bushmaster 1','U',943,'','','',32.3093751484002,-101.629252577686,'','','','','','','','',''),
                (975,'WEL','Bushmaster 2','U',943,'','','',32.3060886404098,-101.628892001408,'','','','','','','','',''),
                (976,'WEL','Bushmaster 3','U',943,'','','',32.3133389705273,-101.630653474357,'','','','','','','','',''),
                (977,'WEL','Bushmaster 4','U',943,'','','',32.3058729041558,-101.635351396109,'','','','','','','','',''),
                (978,'WEL','Rattlesnake 1','U',944,'','','',32.0470831799963,-101.36564773749,'','','','','','','','',''),
                (979,'WEL','Rattlesnake 2','U',944,'','','',32.0471510618828,-101.368021921351,'','','','','','','','',''),
                (980,'WEL','Rattlesnake 3','U',944,'','','',32.0441928546575,-101.371440306664,'','','','','','','','',''),
                (981,'WEL','Rattlesnake 4','U',944,'','','',32.053578982501,-101.365653127002,'','','','','','','','',''),
                (982,'WEL','Rattlesnake 5','U',944,'','','',32.0465138490383,-101.368037197386,'','','','','','','','',''),
                (983,'WEL','Black Mamba 1','U',945,'','','',32.2943919006254,-101.576599068215,'','','','','','','','',''),
                (984,'WEL','Black Mamba 2','U',945,'','','',32.2944763777853,-101.575777621363,'','','','','','','','',''),
                (985,'WEL','Black Mamba 3','U',945,'','','',32.2888691341765,-101.581600873857,'','','','','','','','','')
                ;
                \`, /* sql */ \`
                INSERT INTO equipment (EquipID,EquipTypeID,EquipName,EquipLongDesc,Manufacturer,Model,ManfYear,WebLink,SerialNum,EquipWeight,InstallLocationID,lat,lon,SafetyCritical,StatusID) VALUES
                ('H-327','3','Heat Exchanger 27','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9372',NULL,932,NULL,NULL,'FALSE','ACT'),
                ('H-328','3','Heat Exchanger 28','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9337',NULL,932,NULL,NULL,'FALSE','ACT'),
                ('H-329','3','Heat Exchanger 29','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-3979',NULL,932,NULL,NULL,'FALSE','ACT'),
                ('H-330','3','Heat Exchanger 30','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-8637',NULL,932,NULL,NULL,'FALSE','ACT'),
                ('H-331','3','Heat Exchanger 31','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-5987',NULL,932,NULL,NULL,'FALSE','ACT'),
                ('H-501','3','Cooling Tower 1','Polacel modular series','KLV','CMDIF',2019,'','8675309',NULL,932,NULL,NULL,'TRUE','ACT'),
                ('H-502','3','Cooling Tower 2','Polacel modular series','KLV','CMDIF',2019,'','8675310',NULL,932,NULL,NULL,'TRUE','ACT'),
                ('H-503','3','Cooling Tower 3','Polacel modular series','KLV','CMDIF',2019,'','8675311',NULL,932,NULL,NULL,'TRUE','ACT'),
                ('H-504','3','Cooling Tower 4','Polacel modular series','KLV','CMDIF',2019,'','8675312',NULL,932,NULL,NULL,'TRUE','ACT'),
                ('D-15','21','Desalter B','Natco electric-dynamic desalter','SLB','',2009,'','DSLT-09-1588',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('D-12','21','Desalter A','Natco electric-dynamic desalter','SLB','',2009,'','DSLT-09-1298',NULL,930,29.599827,-95.012267,'TRUE','ACT'),
                ('H-309','3','Heat Exchanger 9','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-8575',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-311','3','Heat Exchanger 11','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-7344',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-312','3','Heat Exchanger 12','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-5507',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-313','3','Heat Exchanger 13','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-4047',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-314','3','Heat Exchanger 14','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-1928',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-315','3','Heat Exchanger 15','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9253',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-316','3','Heat Exchanger 16','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-6957',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-317','3','Heat Exchanger 17','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-1247',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-318','3','Heat Exchanger 18','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-8762',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-319','3','Heat Exchanger 19','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-2733',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('H-320','3','Heat Exchanger 20','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-3779',NULL,930,29.599827,-95.012267,'FALSE','ACT'),
                ('K-104','2','Crude Supply Tank 4','375,000 barrels','CST','T-375',2015,'','2015-6017440T',NULL,933,29.599807,-95.013768,'FALSE','ACT'),
                ('C-17','11','Coke Drum A','Coking drum post vacuum distillation','KLV','C880',2011,'','',NULL,935,29.598308,-95.011206,'FALSE','VFD'),
                ('H-117','3','Crude Preheat Exchanger','Shell and tube heat exchanger (crude-kero)','VRV','HELIXCHANGER',2002,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('K-101','2','Crude Supply Tank 1','375,000 barrels','STK','T-375',2001,'','TNK-298412',NULL,933,29.600161,-95.014462,'FALSE','ACT'),
                ('K-102','2','Crude Supply Tank 2','375,000 barrels','STK','T-375',2001,'','TNK-298634',NULL,933,29.600166,-95.013778,'FALSE','ACT'),
                ('K-103','2','Crude Supply Tank 3','375,000 barrels','STK','T-375',2006,'','TNK-298384',NULL,933,29.5998,-95.014465,'FALSE','ACT'),
                ('R-501','10','Hydrocracker A','Primary phase','STK','',1998,'','',NULL,931,29.599637,-95.012129,'TRUE','VFD'),
                ('R-502','10','Hydrocracker B','Secondary phase','STK','',1998,'','',NULL,931,29.599626,-95.011801,'TRUE','VFD'),
                ('PT-187L','51','Pig Launcher','Location: Yellowbank North','HRZ','S-3000',2009,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','306555293',1144,708,-25.450835,148.631184,'FALSE','ACT'),
                ('PT-207L','51','Pig Launcher','Location: Callide','HRZ','S-3000',2007,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','115213107',1266,707,-24.286205,150.438059,'FALSE','ACT'),
                ('XT-946','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Iron Horse 1 Well','RWE','RWE-CT-2000',2016,'http://www.reinwellheadequipment.com/product-detail/typical-christmas-tree-system','CT2000-1234',5000,946,31.970746,-102.070723,'TRUE','ACT'),
                ('XT-984','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Black Mamba 2 Well','RWE','RWE-CT-2000',2022,'','CT2000-1984',5000,984,32.294476,-101.575778,'TRUE','ACT'),
                ('XT-964','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Thunderhawk 2 Well','RWE','RWE-CT-2000',2020,'','CT2000-1964',5000,964,31.845174,-101.989413,'TRUE','ACT'),
                ('XT-970','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 3 Well','RWE','RWE-CT-2000',2020,'','CT2000-1970',5000,970,32.186123,-101.480402,'TRUE','ACT'),
                ('H-303','3','Heat Exchanger 3','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9837',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-304','4','Heat Exchanger 4','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-8434',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-305','3','Heat Exchanger 5','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9766',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-306','3','Heat Exchanger 6','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-1621',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-307','3','Heat Exchanger 7','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-6345',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-308','3','Heat Exchanger 8','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9865',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-310','3','Heat Exchanger 10','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-1836',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('H-321','3','Heat Exchanger 21','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-6618',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('K-901','2','Biodiesel Feed Tank','Triglycerides','KPM','',2019,'','T220-7911',NULL,934,29.598959,-95.014399,'FALSE','NEW'),
                ('R-901','13','Biodiesel Reactor','Triglycerides mixed with Methanol + catalyst','KPM','',2018,'','CSTR-7911',NULL,934,29.598796,-95.014407,'FALSE','NEW'),
                ('K-902','2','Biodiesel Feed Tank','Methanol','KPM','',2019,'','T420-7701',NULL,934,29.598796,-95.014407,'FALSE','NEW'),
                ('SP-94','23','Biodiesel Separator','Divert residual methanol for reprocessing','KPM','',2017,'','SEP-TG/METH',NULL,934,29.59885,-95.014404,'FALSE','VFD'),
                ('XT-951','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Dire Wolf 1 Well','RWE','RWE-CT-2000',2016,'','CT2000-1951',5000,951,32.036076,-102.12171,'TRUE','ACT'),
                ('XT-947','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Iron Horse 2 Well','RWE','RWE-CT-2000',2016,'','CT2000-1947',5000,947,31.968202,-102.078144,'TRUE','ACT'),
                ('XT-972','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 5 Well','RWE','RWE-CT-2000',2020,'','CT2000-1972',5000,972,32.177523,-101.473343,'TRUE','ACT'),
                ('XT-978','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Rattlesnake 1 Well','RWE','RWE-CT-2000',2018,'','CT2000-1978',5000,978,32.047083,-101.365648,'TRUE','ACT'),
                ('XT-959','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 4 Well','RWE','RWE-CT-2000',2018,'','CT2000-1959',5000,959,32.093491,-102.110243,'TRUE','ACT'),
                ('XT-974','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Bushmaster 1 Well','RWE','RWE-CT-2000',2021,'','CT2000-1974',5000,974,32.309375,-101.629253,'TRUE','ACT'),
                ('XT-980','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Rattlesnake 3 Well','RWE','RWE-CT-2000',2018,'','CT2000-1980',5000,980,32.044193,-101.37144,'TRUE','ACT'),
                ('XT-956','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 1 Well','RWE','RWE-CT-2000',2018,'','CT2000-1956',5000,956,32.097417,-102.106435,'TRUE','ACT'),
                ('XT-973','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 6 Well','RWE','RWE-CT-2000',2020,'','CT2000-1973',5000,973,32.185112,-101.473048,'TRUE','ACT'),
                ('XT-958','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 3 Well','RWE','RWE-CT-2000',2018,'','CT2000-1958',5000,958,32.095331,-102.105594,'TRUE','ACT'),
                ('XT-955','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Maverick 2 Well','RWE','RWE-CT-2000',2021,'','CT2000-1955',5000,955,31.904157,-102.065734,'TRUE','ACT'),
                ('XT-963','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Thunderhawk 1 Well','RWE','RWE-CT-2000',2020,'','CT2000-1963',5000,963,31.841973,-101.992266,'TRUE','ACT'),
                ('XT-950','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Iron Horse 5 Well','RWE','RWE-CT-2000',2017,'','CT2000-1950',5000,950,31.969124,-102.080051,'TRUE','ACT'),
                ('XT-948','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Iron Horse 3 Well','RWE','RWE-CT-2000',2016,'','CT2000-1948',5000,948,31.971594,-102.077971,'TRUE','ACT'),
                ('XT-952','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Dire Wolf 2 Well','RWE','RWE-CT-2000',2016,'','CT2000-1952',5000,952,32.028534,-102.123264,'TRUE','ACT'),
                ('XT-966','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Thunderhawk 4 Well','RWE','RWE-CT-2000',2020,'','CT2000-1966',5000,966,31.842354,-101.991197,'TRUE','ACT'),
                ('XT-975','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Bushmaster 2 Well','RWE','RWE-CT-2000',2021,'','CT2000-1975',5000,975,32.306089,-101.628892,'TRUE','ACT'),
                ('XT-965','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Thunderhawk 3 Well','RWE','RWE-CT-2000',2020,'','CT2000-1965',5000,965,31.839937,-101.995951,'TRUE','ACT'),
                ('XT-971','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 4 Well','RWE','RWE-CT-2000',2020,'','CT2000-1971',5000,971,32.180364,-101.480739,'TRUE','ACT'),
                ('XT-983','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Black Mamba 1 Well','RWE','RWE-CT-2000',2022,'','CT2000-1983',5000,983,32.294392,-101.576599,'TRUE','ACT'),
                ('XT-967','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Diamondback 1 Well','RWE','RWE-CT-2000',2016,'','CT2000-1967',5000,967,32.248671,-101.52136,'TRUE','ACT'),
                ('XT-954','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Maverick 1 Well','RWE','RWE-CT-2000',2020,'','CT2000-1954',5000,954,31.904113,-102.065222,'TRUE','ACT'),
                ('XT-976','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Bushmaster 3 Well','RWE','RWE-CT-2000',2021,'','CT2000-1976',5000,976,32.313339,-101.630653,'TRUE','ACT'),
                ('XT-957','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 2 Well','RWE','RWE-CT-2000',2018,'','CT2000-1957',5000,957,32.091874,-102.111343,'TRUE','ACT'),
                ('XT-949','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Iron Horse 4 Well','RWE','RWE-CT-2000',2017,'','CT2000-1949',5000,949,31.96658,-102.079991,'TRUE','ACT'),
                ('XT-985','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Black Mamba 3 Well','RWE','RWE-CT-2000',2022,'','CT2000-1985',5000,985,32.288869,-101.581601,'TRUE','ACT'),
                ('XT-981','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Rattlesnake 4 Well','RWE','RWE-CT-2000',2019,'','CT2000-1981',5000,981,32.053579,-101.365653,'TRUE','ACT'),
                ('XT-953','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Dire Wolf 3 Well','RWE','RWE-CT-2000',2016,'','CT2000-1953',5000,953,32.029498,-102.12042,'TRUE','ACT'),
                ('XT-969','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 2 Well','RWE','RWE-CT-2000',2020,'','CT2000-1969',5000,969,32.178128,-101.473068,'TRUE','ACT'),
                ('XT-962','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 7 Well','RWE','RWE-CT-2000',2019,'','CT2000-1962',5000,962,32.091971,-102.113466,'TRUE','ACT'),
                ('XT-977','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Bushmaster 4 Well','RWE','RWE-CT-2000',2021,'','CT2000-1977',5000,977,32.305873,-101.635351,'TRUE','ACT'),
                ('XT-968','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Copperhead 1 Well','RWE','RWE-CT-2000',2020,'','CT2000-1968',5000,968,32.180045,-101.474763,'TRUE','ACT'),
                ('XT-961','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 6 Well','RWE','RWE-CT-2000',2019,'','CT2000-1961',5000,961,32.096318,-102.111312,'TRUE','ACT'),
                ('XT-960','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Sidewinder 5 Well','RWE','RWE-CT-2000',2019,'','CT2000-1960',5000,960,32.094326,-102.11313,'TRUE','ACT'),
                ('XT-979','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Rattlesnake 2 Well','RWE','RWE-CT-2000',2018,'','CT2000-1979',5000,979,32.047151,-101.368022,'TRUE','ACT'),
                ('XT-982','26','Wellhead Christmas Tree','Wellhead Christmas Tree for Rattlesnake 5 Well','RWE','RWE-CT-2000',2019,'','CT2000-1982',5000,982,32.046514,-101.368037,'TRUE','ACT'),
                ('W-82749','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,938,31.9054,-102.0612,'FALSE','ACT'),
                ('W-47321','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',NULL,938,31.9054,-102.0612,'TRUE','ACT'),
                ('W-99002','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,936,31.9686,-102.0757,'FALSE','ACT'),
                ('W-99004','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,937,32.0322,-102.1231,'FALSE','ACT'),
                ('W-99006','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,939,32.0928,-102.1105,'FALSE','ACT'),
                ('W-99008','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,940,31.8419,-101.9939,'FALSE','ACT'),
                ('W-99010','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,941,32.2456,-101.5231,'FALSE','ACT'),
                ('W-99012','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,942,32.1822,-101.4758,'FALSE','ACT'),
                ('W-99014','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,943,32.3093,-101.6305,'FALSE','ACT'),
                ('W-99016','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,944,32.0489,-101.3684,'FALSE','ACT'),
                ('W-99018','32','RTU','Emerson FloBob Remote Terminal Unit for well monitoring and control','EMR','FloBob 107',2018,'https://www.emerson.com/en-us/automation/remote-terminal-units/flobob-107','FB107-2018-0045',75,945,32.2917,-101.5806,'FALSE','ACT'),
                ('W-99001','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,936,31.9686,-102.0757,'TRUE','ACT'),
                ('W-99003','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,937,32.0322,-102.1231,'TRUE','ACT'),
                ('W-99005','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,939,32.0928,-102.1105,'TRUE','ACT'),
                ('W-99007','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,940,31.8419,-101.9939,'TRUE','ACT'),
                ('W-99009','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,941,32.2456,-101.5231,'TRUE','ACT'),
                ('W-99011','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,942,32.1822,-101.4758,'TRUE','ACT'),
                ('W-99013','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,943,32.3093,-101.6305,'TRUE','ACT'),
                ('W-99015','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,944,32.0489,-101.3684,'TRUE','ACT'),
                ('W-99017','34','Flare Stack','Zeeco Enclosed Ground Flare','ZCO','EGFE-48',2020,'https://www.zeeco.com/enclosed-ground-flares','EGFE-48-2020-0012',5000,945,32.2917,-101.5806,'TRUE','ACT'),
                ('PT-231L','51','Pig Launcher','Location: Bauhina','HRZ','S-3000',2013,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','577119993',1200,706,-24.591063,149.296095,'FALSE','ACT'),
                ('PT-142L','51','Pig Launcher','Location: Myall','HRZ','S-3000',2014,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','979805466',1256,705,-26.05396,148.854601,'FALSE','ACT'),
                ('PT-187R','51','Pig Receiver','Location: Yellowbank North','HRZ','R-850',2008,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','582816360',1481,708,-25.450835,148.631184,'FALSE','ACT'),
                ('PT-207R','51','Pig Receiver','Location: Callide','HRZ','R-850',2014,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','651903566',761,707,-24.286205,150.438059,'FALSE','ACT'),
                ('PT-231R','51','Pig Receiver','Location: Bauhina','HRZ','R-850',2010,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','379542380',1236,706,-24.591063,149.296095,'FALSE','ACT'),
                ('PT-182L','51','Pig Launcher','Location: Wallumbilla','HRZ','S-3000',2015,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','115079235',1110,704,-26.692543,149.188419,'FALSE','ACT'),
                ('PT-147L','51','Pig Launcher','Location: Chinchilla','HRZ','S-3000',2007,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','927342835',772,703,-26.989455,150.449455,'FALSE','ACT'),
                ('PT-159L','51','Pig Launcher','Location: Dalby','HRZ','S-3000',2005,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','761291773',601,702,-27.185334,151.203374,'FALSE','ACT'),
                ('H-322','3','Heat Exchanger 22','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9021',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('H-323','3','Heat Exchanger 23','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-3171',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('H-324','3','Heat Exchanger 24','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-1181',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('H-325','3','Heat Exchanger 25','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-4747',NULL,931,29.599632,-95.011965,'FALSE','ACT'),
                ('H-332','3','Heat Exchanger 32','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-2332',NULL,933,29.599984,-95.014118,'FALSE','ACT'),
                ('H-333','3','Heat Exchanger 33','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-8723',NULL,933,29.599984,-95.014118,'FALSE','ACT'),
                ('H-334','3','Heat Exchanger 34','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-6681',NULL,933,29.599984,-95.014118,'FALSE','ACT'),
                ('H-335','3','Heat Exchanger 35','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-3107',NULL,933,29.599984,-95.014118,'FALSE','ACT'),
                ('P-101','7','Atmospheric Crude Pump','Crude pump feeding the still tower','CAS','Series 300',1997,'','23-SHFL-2934',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('P-102','7','Vacuum Crude Pump','Crude pump feeding the vacuum tower','PWK','PWH OH2',2001,'','1987-129673-01',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('R-101','13','Reactor 1','Primary reactor','HTC','RR 808',1989,'','90-RR-X04',NULL,931,29.599632,-95.011965,'TRUE','ACT'),
                ('T-301','1','Atmospheric Still Tower','Custom built (on-site) distillation tower','BDM','',2006,'','ADT-1057',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('T-402','4','Vacuum Still Tower','Custom built (on-site) distillation tower','BDM','',2007,'','VDT-2049',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('S-15','2','Gasoline Tank 1','','STK','',1982,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-16','2','Diesel Tank','','STK','',1996,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-17','2','Lubes Tank','','STK','',2004,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-18','2','Olefins Tank','','STK','',2001,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-19','2','Gasoline Tank 2','','STK','',2006,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-20','2','Cycle Oil Tank','','STK','',1989,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-21','2','Pet Coke Tank','','STK','',1984,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('S-23','2','Biodiesel Tank','','STK','',2023,'','',NULL,933,29.599984,-95.014118,'TRUE','VFD'),
                ('C-18','11','Coke Drum B','Coking drum post vacuum distillation','KLV','C880',2011,'','',NULL,935,29.598308,-95.011206,'FALSE','VFD'),
                ('P-501','7','Resid Pump','','KLV','PWH OH4',2010,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('P-502','7','Coke Feed Pump','','KLV','PWH OH5',2009,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('F-35','8','Resid Furnace','','KLV','BB2-HDX',2012,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('F-36','8','Coke Feed Furnace','','KLV','BB2-HDX',2011,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('T-511','24','Main Fractionator','','KLV','',2008,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('V-101','25','Coke Conveyor','','KLV','FECCO',2012,'','HX-1170',NULL,929,29.601715,-95.011649,'FALSE','VFD'),
                ('PT-117L','51','Pig Launcher','Location: Gladstone Plant','HRZ','S-3000',2017,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','785219701',1100,701,-23.918903,151.337142,'TRUE','ACT'),
                ('PT-142R','51','Pig Receiver','Location: Myall','HRZ','R-850',2013,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','863846655',1479,705,-26.05396,148.854601,'FALSE','ACT'),
                ('PT-182R','51','Pig Receiver','Location: Wallumbilla','HRZ','R-850',2014,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','801257726',782,704,-26.692543,149.188419,'FALSE','ACT'),
                ('PT-147R','51','Pig Receiver','Location: Chinchilla','HRZ','R-850',2016,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','196268594',999,703,-26.989455,150.449455,'FALSE','ACT'),
                ('PT-159R','51','Pig Receiver','Location: Dalby','HRZ','R-850',2013,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','489995585',777,702,-27.185334,151.203374,'FALSE','ACT'),
                ('PT-117R','51','Pig Receiver','Location: Gladstone Plant','HRZ','R-850',2004,'https://www.horizonindustrial.com.au/pigging-equipment/pig-launchers-pig-receivers','423937293',1221,701,-23.918903,151.337142,'TRUE','ACT'),
                ('F-201','8','Atmospheric Furnace 1','Primary crude heating mechanism going into atmospheric still','FSV','BB2-HDX',1997,'','2975621',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('F-202','8','Atmospheric Furnace 2','Secondary crude heating mechanism going into atmospheric still','FSV','BB2-HDX',1997,'','2974893',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('F-203','8','Atmospheric Furnace 3','Tertiary crude heating mechanism going into atmospheric still','FSV','BB2-HDX',1997,'','2974904',NULL,929,29.601715,-95.011649,'TRUE','ACT'),
                ('F-204','8','Atmospheric Furnace 4','Quarternary crude heating mechanism going into atmospheric still','FSV','BB2-HDX',1997,'','2974905',NULL,929,29.601715,-95.011649,'TRUE','INV'),
                ('H-301','3','Heat Exchanger 1','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-9837',NULL,929,29.601715,-95.011649,'FALSE','ACT'),
                ('H-302','3','Heat Exchanger 2','Uses residual heat for further thermal operations','KLV','ECOMI',2012,'','EM-12-2354',NULL,929,29.601715,-95.011649,'FALSE','ACT')
                ;
                \`, /* sql */ \`
                INSERT INTO Maintenance (MaintID,MaintTypeID,EquipID,MaintName,MaintLongDesc,WorkOrderID,EffortHours,EstCost,DowntimeReq,TechnicianID,ResponsibleID,RequiresPermit,StatusID,PlannedDateStart,PlannedDateEnd,ActualDateStart,ActualDateEnd) VALUES
                (9247,'CM','F-201','[OFFLINE] Inspect and clean heating element','maintenance can be done without downtime as equipment is not in service','WO-188856',2,NULL,'FALSE','Amy Owen','Malvika Brown','FALSE','VFD','2003-06-18','2003-06-18','2003-06-18','2003-06-20'),
                (9275,'CM','P-101','Crude pump motor failure','Fuse replaced - back online with no startup issues','WO-147184',4,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-02-17','2005-02-17','2005-02-17','2005-02-17'),
                (9273,'CM','P-101','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-146801',26,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-06-28','2005-06-28','2005-06-28','2005-06-28'),
                (9274,'CM','P-101','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-147210',18,NULL,'FALSE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-07-12','2005-07-12','2005-07-12','2005-07-12'),
                (9277,'CM','P-101','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-147283',36,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-11-11','2005-11-11','2005-11-11','2005-11-11'),
                (9276,'CM','P-101','Crude pump motor failure','Cracked housing needed replacement and resurfacing','WO-147216',95,NULL,'FALSE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-11-17','2005-11-21','2005-11-17','2005-11-27'),
                (9322,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-146188',30,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-02-18','2005-02-18','2005-02-18','2005-02-18'),
                (9323,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-146177',40,NULL,'FALSE','Luanne Mikeska','Richard Dunston','TRUE','VFD','2005-06-29','2005-06-29','2005-06-29','2005-06-29'),
                (9324,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-146305',20,NULL,'FALSE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-07-13','2005-07-13','2005-07-13','2005-07-13'),
                (9325,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-148070',20,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-11-11','2005-11-11','2005-11-11','2005-11-11'),
                (9326,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-148095',20,NULL,'FALSE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-11-19','2005-11-20','2005-11-19','2005-11-20'),
                (9321,'CM','P-102','Crude pump motor failure','Repair or replacement of failed motor on the crude oil pump P-102','WO-145434',16,NULL,'FALSE','Jillian Juarez','Richard Dunston','TRUE','VFD','2005-12-22','2005-12-23','2006-01-03','2006-01-05'),
                (9249,'CM','R-101','Reactor C pressure leak','Operator reported that condition occurred earlier in the year','WO-148023',10,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','2014-08-20','2014-08-20','2014-08-20','2014-08-21'),
                (9250,'CM','R-101','Reactor A pressure leak','Root cause of leak not identified - not detected after startup','WO-147443',8,NULL,'TRUE','Jillian Juarez','Richard Dunston','TRUE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9248,'PM','F-202','Inspect and clean heating element','Require confined space permit and follow SP Ops Procedure CF-2112','WO-311996',4,NULL,'TRUE','Amy Owne','Malvika Brown','TRUE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9278,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-160511',20,NULL,'TRUE','Steve Perry','Malvika Brown','TRUE','VFD','2017-01-15','2017-01-18','2017-01-15','2017-01-18'),
                (9279,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-160627',20,NULL,'TRUE','Steve Perry','Malvika Brown','TRUE','VFD','2017-04-15','2017-04-18','2017-04-15','2017-04-18'),
                (9280,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161049',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2017-07-14','2017-07-17','2017-07-14','2017-07-17'),
                (9281,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161347',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2017-10-12','2017-10-15','2017-10-12','2017-10-15'),
                (9282,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161544',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2018-01-10','2018-01-13','2018-01-10','2018-01-13'),
                (9283,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161650',20,NULL,'TRUE','Luanne Mikeska','Malvika Brown','TRUE','VFD','2018-04-10','2018-04-13','2018-04-10','2018-04-13'),
                (9284,'PM','P-101','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161975',20,NULL,'TRUE','Luanne Mikeska','Malvika Brown','TRUE','VFD','2018-07-09','2018-07-12','2018-07-09','2018-07-12'),
                (9285,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161903',20,NULL,'TRUE','Steve Perry','Malvika Brown','TRUE','VFD','2018-10-07','2018-10-10','2018-10-07','2018-10-10'),
                (9286,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161706',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2019-01-05','2019-01-08','2019-01-05','2019-01-08'),
                (9287,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161392',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2019-04-05','2019-04-08','2019-04-05','2019-04-08'),
                (9288,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-160571',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','2019-07-04','2019-07-07','2019-07-04','2019-07-07'),
                (9289,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-160645',20,NULL,'TRUE','Luanne Mikeska','Malvika Brown','TRUE','VFD','2019-10-02','2019-10-05','2019-10-02','2019-10-05'),
                (9290,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-161088',20,NULL,'TRUE','Steve Perry','Malvika Brown','TRUE','VFD','2019-12-31','2020-01-03','2019-12-31','2020-01-03'),
                (9291,'PM','P-102','Pumps and Motors Quarterly Maintenance','Follow manufacturers recommended schedule based on age and hours of service','WO-146663',20,NULL,'TRUE','Steve Perry','Malvika Brown','TRUE','VFD','2020-03-30','2020-04-02','2020-03-30','2020-04-02'),
                (9419,'PM','PT-117L','2023 Summer Pigging','Pigging of 4 product line','WO-271169',40,NULL,'TRUE','NULL','Sarah Thompson','TRUE','VFD','2023-09-04','2023-09-11','2023-09-04','2023-09-11'),
                (9435,'PM','PT-117L','2023 Winter Pigging','Pigging of 4in product line','WO-271185',40,NULL,'TRUE','NULL','Sarah Thompson','TRUE','VFD','2024-01-22','2024-02-05','2024-01-22','2024-02-05'),
                (9420,'PM','PT-117R','2023 Summer Pigging','Pigging of 4in product line','WO-271170',40,NULL,'TRUE','NULL','Sarah Thompson','TRUE','VFD','2023-09-04','2023-09-11','2023-09-04','2023-09-11'),
                (9436,'PM','PT-117R','2023 Winter Pigging','Pigging of 4in product line','WO-271186',40,NULL,'TRUE','NULL','Sarah Thompson','TRUE','VFD','2024-01-22','2024-02-05','2024-01-22','2024-02-05'),
                (9411,'PM','PT-142L','2023 Summer Pigging','Pigging of 6in product line','WO-271161',40,NULL,'TRUE','NULL','Michael Brown','TRUE','VFD','2023-07-10','2023-07-17','2023-07-10','2023-07-17'),
                (9427,'PM','PT-142L','2023 Winter Pigging','Pigging of 6in product line','WO-271177',40,NULL,'TRUE','NULL','Michael Brown','TRUE','VFD','2023-12-18','2024-01-02','2023-12-18','2024-01-02'),
                (9412,'PM','PT-142R','2023 Summer Pigging','Pigging of 6in product line','WO-271162',40,NULL,'TRUE','NULL','Michael Brown','TRUE','COM','2023-07-10','2023-07-17','2023-07-10','2023-07-17'),
                (9428,'PM','PT-142R','2023 Winter Pigging','Pigging of 6in product line','WO-271178',40,NULL,'TRUE','NULL','Michael Brown','TRUE','VFD','2023-12-18','2024-01-02','2023-12-18','2024-01-02'),
                (9415,'PM','PT-147L','2023 Summer Pigging','Pigging of 8in product line','WO-271165',40,NULL,'TRUE','NULL','Emily Wilson','TRUE','VFD','2023-08-07','2023-08-14','2023-08-07','2023-08-21'),
                (9431,'PM','PT-147L','2023 Winter Pigging','Pigging of 8in product line','WO-271181',40,NULL,'TRUE','NULL','Emily Wilson','TRUE','VFD','2024-01-08','2024-01-22','2024-01-08','2024-01-22'),
                (9403,'PM','PT-147L','Bi-annual pigging','Pigging is the practice of using pipeline inspection gauges to perform various maintenance operations on a pipeline, without stopping the flow of the product in the pipeline.','WO-271153',NULL,NULL,'FALSE','PIS','SarahJohnston','TRUE','VFD','2024-07-30','2024-08-09','2024-07-29','2024-08-08'),
                (9416,'PM','PT-147R','2023 Summer Pigging','Pigging of 8in product line','WO-271166',40,NULL,'TRUE','NULL','Emily Wilson','TRUE','VFD','2023-08-07','2023-08-14','2023-08-07','2023-08-14'),
                (9432,'PM','PT-147R','2023 Winter Pigging','Pigging of 8in product line','WO-271182',40,NULL,'TRUE','NULL','Emily Wilson','TRUE','VFD','2024-01-08','2024-01-22','2024-01-08','2024-01-22'),
                (9417,'PM','PT-159L','2023 Summer Pigging','Pigging of 6in crude line','WO-271167',40,NULL,'TRUE','NULL','David Taylor','TRUE','VFD','2023-08-21','2023-08-28','2023-08-28','2023-09-04'),
                (9433,'PM','PT-159L','2023 Winter Pigging','Pigging of 6in crude line','WO-271183',40,NULL,'TRUE','NULL','David Taylor','TRUE','VFD','2024-01-15','2024-01-29','2024-01-15','2024-01-29'),
                (9402,'PM','PT-159L','Bi-annual pigging','Pigging is the practice of using pipeline inspection gauges to perform various maintenance operations on a pipeline, without stopping the flow of the product in the pipeline.','WO-271152',NULL,NULL,'FALSE','PIS','SarahJohnston','TRUE','VFD','2024-07-15','2024-07-25','2024-07-15','2024-07-24'),
                (9418,'PM','PT-159R','2023 Summer Pigging','Pigging of 6in crude line','WO-271168',40,NULL,'TRUE','NULL','David Taylor','TRUE','VFD','2023-08-21','2023-08-28','2023-08-21','2023-08-28'),
                (9434,'PM','PT-159R','2023 Winter Pigging','Pigging of 6in crude line','WO-271184',40,NULL,'TRUE','NULL','David Taylor','TRUE','VFD','2024-01-15','2024-01-29','2024-01-15','2024-01-29'),
                (9413,'PM','PT-182L','2023 Summer Pigging','Pigging of 10in crude line','WO-271163',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-07-24','2023-07-31','2023-07-24','2023-08-07'),
                (9429,'PM','PT-182L','2023 Winter Pigging','Pigging of 10in crude line','WO-271179',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-12-27','2024-01-10','2023-12-27','2024-01-10'),
                (9401,'PM','PT-182L','Bi-annual pigging','Pigging is the practice of using pipeline inspection gauges to perform various maintenance operations on a pipeline, without stopping the flow of the product in the pipeline.','WO-271151',NULL,NULL,'FALSE','PIS','SarahJohnston','TRUE','VFD','2024-07-01','2024-07-10','2024-07-01','2024-07-09'),
                (9414,'PM','PT-182R','2023 Summer Pigging','Pigging of 10in crude line','WO-271164',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-07-24','2023-07-31','2023-07-24','2023-07-31'),
                (9430,'PM','PT-182R','2023 Winter Pigging','Pigging of 10in crude line','WO-271180',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-12-27','2024-01-10','2023-12-27','2024-01-10'),
                (9405,'PM','PT-187L','2023 Summer Pigging','Pigging of 12in crude line','WO-271155',40,NULL,'TRUE','','John Smith','TRUE','VFD','2023-06-01','2023-06-08','2023-06-01','2023-06-07'),
                (9421,'PM','PT-187L','2023 Winter Pigging','Pigging of 12in crude line','WO-271171',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-11-27','2023-12-11','2023-11-27','2023-12-11'),
                (9406,'PM','PT-187R','2023 Summer Pigging','Pigging of 12in crude line','WO-271156',40,NULL,'TRUE','NULL','John Smith','TRUE','COM','2023-06-01','2023-06-08','2023-06-01','2023-06-08'),
                (9422,'PM','PT-187R','2023 Winter Pigging','Pigging of 12in crude line','WO-271172',40,NULL,'TRUE','NULL','John Smith','TRUE','VFD','2023-11-27','2023-12-11','2023-11-27','2023-12-11'),
                (9407,'PM','PT-207L','2023 Summer Pigging','Pigging of 10in product line','WO-271157',40,NULL,'TRUE','','Jane Doe','TRUE','VFD','2023-06-12','2023-06-19','2023-06-12','2023-06-18'),
                (9423,'PM','PT-207L','2023 Winter Pigging','Pigging of 10in product line','WO-271173',40,NULL,'TRUE','NULL','Jane Doe','TRUE','VFD','2023-12-04','2023-12-18','2023-12-04','2023-12-18'),
                (9408,'PM','PT-207R','2023 Summer Pigging','Pigging of 10in product line','WO-271158',40,NULL,'TRUE','','Jane Doe','TRUE','VFD','2023-06-12','2023-06-19','2023-06-12','2023-06-18'),
                (9424,'PM','PT-207R','2023 Winter Pigging','Pigging of 10in product line','WO-271174',40,NULL,'TRUE','NULL','Jane Doe','TRUE','VFD','2023-12-04','2023-12-18','2023-12-04','2023-12-18'),
                (9409,'PM','PT-231L','2023 Summer Pigging','Pigging of 8in crude line','WO-271159',40,NULL,'TRUE','NULL','Robert Johnson','TRUE','VFD','2023-06-26','2023-07-03','2023-06-26','2023-07-10'),
                (9425,'PM','PT-231L','2023 Winter Pigging','Pigging of 8in crude line','WO-271175',40,NULL,'TRUE','NULL','Robert Johnson','TRUE','VFD','2023-12-11','2023-12-27','2023-12-11','2023-12-27'),
                (9404,'PM','PT-231L','Bi-annual pigging','Pigging is the practice of using pipeline inspection gauges to perform various maintenance operations on a pipeline, without stopping the flow of the product in the pipeline.','WO-271154',NULL,NULL,'FALSE','PIS','SarahJohnston','TRUE','VFD','2024-08-19','2024-08-30','2024-09-15','2024-08-29'),
                (9410,'PM','PT-231R','2023 Summer Pigging','Pigging of 8in crude line','WO-271160',40,NULL,'TRUE','NULL','Robert Johnson','TRUE','VFD','2023-06-26','2023-07-03','2023-06-26','2023-07-03'),
                (9426,'PM','PT-231R','2023 Winter Pigging','Pigging of 8in crude line','WO-271176',40,NULL,'TRUE','NULL','Robert Johnson','TRUE','VFD','2023-12-11','2023-12-27','2023-12-11','2023-12-27'),
                (9294,'PM','R-101','Reactor periodic inspection','Periodic internal inspection of the reactor vessel including checks for corrosion, cracks, and other defects','WO-162045',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9292,'PM','R-101','Reactor periodic inspection','Periodic internal inspection of the reactor vessel including checks for corrosion, cracks, and other defects','WO-161619',20,NULL,'FALSE','Steve Perry','Malvika Brown','TRUE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9293,'PM','R-901','Biodiesel reactor periodic inspection','Extra steps necessary to ensure smooth operation of recently installed equipment','WO-161165',40,NULL,'FALSE','Tom Clancy','Axel Foley','TRUE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9272,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-194262',12,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','ASG','1970-01-01','1970-01-01','1970-01-01','1970-01-01'),
                (9261,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159611',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9262,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159691',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9263,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-145042',12,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9264,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-145114',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9265,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159931',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9266,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160014',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9267,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160094',12,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9268,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160177',12,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9269,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160257',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9270,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160339',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9271,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-160422',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9251,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-158798',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9252,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-158881',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9253,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-158958',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9254,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159041',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9255,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159121',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-01'),
                (9256,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159203',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-04'),
                (9257,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159283',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-04'),
                (9258,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159366',12,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1969-12-30','1970-01-04'),
                (9259,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159449',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9260,'PM','T-301','Still Tower A Monthly Maintenance','Perform regularly scheduled maintenance','WO-159529',12,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9317,'PM','T-402','Still Tower B Monthly Maintenance','JUL-21: Perform regularly scheduled maintenance','WO-160460',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-03'),
                (9318,'PM','T-402','Still Tower B Monthly Maintenance','JUN-21: Perform regularly scheduled maintenance','WO-160399',18,NULL,'TRUE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-03'),
                (9319,'PM','T-402','Still Tower B Monthly Maintenance','APR-21: Perform regularly scheduled maintenance','WO-160374',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-03'),
                (9320,'PM','T-402','Still Tower B Monthly Maintenance','FEB-21: Perform regularly scheduled maintenance','WO-160149',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-03'),
                (9316,'PM','T-402','Still Tower B Monthly Maintenance','AUG-21: Perform regularly scheduled maintenance','WO-145627',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9296,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-143819',18,NULL,'TRUE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9297,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158453',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9298,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158710',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9299,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158505',18,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9295,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158078',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9300,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158612',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9301,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-144178',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9311,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159261',18,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9312,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159507',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9302,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-158800',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9303,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-160042',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9304,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-160130',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9305,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-145242',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9306,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159939',18,NULL,'TRUE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9307,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159188',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9308,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159294',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9309,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159270',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9310,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159344',18,NULL,'TRUE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9313,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-145057',18,NULL,'FALSE','Steve Perry','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9314,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159595',18,NULL,'FALSE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9315,'PM','T-402','Still Tower B Monthly Maintenance','Perform regularly scheduled maintenance','WO-159711',18,NULL,'TRUE','Luanne Mikeska','Malvika Brown','FALSE','VFD','1970-01-01','1970-01-01','1970-01-01','1970-01-04'),
                (9447,'CM','K-901','Tank Clog','Cleared clog in Triglyceride Tank K-901 at Biodiesel Unit due to sludge buildup','WO-189189',12,8501.75,'TRUE','Maria Rodriguez','Jake Thompson','TRUE','COM','2024-09-18','2024-09-18','2024-09-18','2024-09-18')
                ;
                \`
              ]
              
              for (const sqlCommand of sqlCommands) {
                  const params = {
                      resourceArn: '${maintDb.clusterArn}',
                      secretArn: '${maintDb.secret?.secretArn}',
                      database: '${defaultDatabaseName}',
                      sql: sqlCommand
                  };

                  console.log('Executing SQL command:', sqlCommand)

                  const command = new ExecuteStatementCommand(params);
                  await rdsDataClient.send(command);
              }
          };
        `),
    });

    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['rds-data:ExecuteStatement'],
        resources: [maintDb.clusterArn],
    }))
    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [maintDb.secret!.secretArn],
    }))
    // Create a Custom Resource that invokes the lambda function to populate sample data into CMMS database
    const prepDb = new cr.AwsCustomResource(scope, `PrepDatabase`, {
        onCreate: {
            service: 'Lambda',
            action: 'invoke',
            parameters: {
                FunctionName: prepDbFunction.functionName,
                Payload: JSON.stringify({}), // No need to pass an event
            },
            physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [prepDbFunction.functionArn],
            }),
        ]),
    });

    prepDb.node.addDependency(writerNode)// Now the prepDb resource will wait until the database is available before running the setup script.


    // ===== MAINTENANCE KNOWLEDGE BASE =====
    // Bedrock KB with OpenSearchServerless (OSS) vector backend
    const maintenanceKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `MaintKB`, {//${stackName.slice(-5)}
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        name: knowledgeBaseName,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to industrial facility maintenance and operations`,
        description: 'Maintenance Knowledge Base',
    });
    const s3docsDataSource = maintenanceKnowledgeBase.addS3DataSource({
        bucket: props.s3Bucket,
        dataSourceName: "a4e-kb-ds-s3-maint",
        inclusionPrefixes: ['maintenance-agent/'],
        //chunkingStrategy: cdkLabsBedrock.ChunkingStrategy.NONE
    })
    const oilfieldServiceDataSource = maintenanceKnowledgeBase.addWebCrawlerDataSource({
        dataSourceName: "a4e-kb-ds-web",
        sourceUrls: ['https://novaoilfieldservices.com/learn/'],
        dataDeletionPolicy: cdkLabsBedrock.DataDeletionPolicy.RETAIN,
        chunkingStrategy: cdkLabsBedrock.ChunkingStrategy.HIERARCHICAL_TITAN
    })

    // ===== ACTION GROUP =====
    // Lambda Function
    const lambdaFunction = new lambda.Function(scope, 'QueryCMMS', {
        //functionName: 'Query-CMMS',
        description: 'Agents4Energy tools to query CMMS database',
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset('amplify/functions/text2SQL/'),
        handler: 'maintenanceAgentAG.lambda_handler',
        timeout: cdk.Duration.seconds(90),
        environment: {
            database_name: defaultDatabaseName,
            db_resource_arn: maintDb.clusterArn,
            db_credentials_secrets_arn: maintDb.secret!.secretArn,
        }
    });
    lambdaFunction.node.addDependency(maintDb);
    // Add DB query permissions to the Lambda function's role
    const policyRDS = new iam.PolicyStatement({
        actions: ["rds-data:ExecuteStatement", "rds-data:ExecuteSql",],
        resources: [maintDb.clusterArn]
    });
    // Add Secret permissions to the Lambda function's role
    const policySecret = new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue",],
        resources: [maintDb.secret!.secretArn]
    });
    // Add the policies to the Lambda function's role
    if (lambdaFunction.role) {
        lambdaFunction.role.addToPrincipalPolicy(policyRDS);
        lambdaFunction.role.addToPrincipalPolicy(policySecret);
    } else {
        console.warn("Lambda function role is undefined, cannot add policy.");
    }

    // ===== BEDROCK AGENT =====
    //const agentMaint = new BedrockAgent(scope, 'MaintenanceAgent', {
    const agentMaint = new bedrock.CfnAgent(scope, 'MaintenanceAgent', {
        agentName: agentName,
        description: agentDescription,
        instruction: `You are an industrial maintenance specialist who has access to files and data about internal company operations.  
        Shift handover reports, maintenance logs, work permits, safety inspections and other data should be used to provide insights on the efficiency and 
        safety of operations for the facility or operations manager.  To find information from the Computerized Maintenance Management System (CMMS), first 
        try to use the action group tool to query the SQL database as it is is the definitive system of record for information.  
        
        The kb-maintenance Bedrock Knowledge base may also have information in documents.  Alert the user if you find discrepancies between the relational 
        database and documents in the KB.  For each request, check both data sources and compare the data to see if it matches.  When running SQL statements, 
        verify that the syntax is correct and results are returned from the CMMS database.  If you do not get results, rewrite the query and try again.`,
        foundationModel: foundationModel,
        autoPrepare: true,
        knowledgeBases: [{
            description: 'Maintenance Knowledge Base',
            knowledgeBaseId: maintenanceKnowledgeBase.knowledgeBaseId,
            // the properties below are optional
            knowledgeBaseState: 'ENABLED',
        }],
        actionGroups: [{
            actionGroupName: 'Query-CMMS-AG',
            actionGroupExecutor: {
                lambda: lambdaFunction.functionArn,
            },
            actionGroupState: 'ENABLED',
            description: 'Action group to perform SQL queries against CMMS database',
            functionSchema: {
                functions: [{
                    name: 'get_tables',
                    description: 'get a list of usable tables from the database',
                }, {
                    name: 'get_tables_information',
                    description: 'get the column level details of a list of tables',
                    parameters: {
                        'tables_list': {
                            type: 'array',
                            description: 'list of tables',
                            required: true,
                        },
                    },
                }, {
                    name: 'execute_statement',
                    description: 'Execute a SQL query against the CMMS databases',
                    parameters: {
                        'sql_statement': {
                            type: 'string',
                            description: 'the SQL query to execute',
                            required: true,
                        },
                    },
                }
                ],
            },
        }],
        agentResourceRoleArn: bedrockAgentRole.roleArn,
        promptOverrideConfiguration: {
            promptConfigurations: [{
                basePromptTemplate: `{
        "anthropic_version": "bedrock-2023-05-31",
        "system": "
            $instruction$
            You have been provided with a set of functions to answer the user's question.
            You must call the functions in the format below:
            <function_calls>
            <invoke>
                <tool_name>$TOOL_NAME</tool_name>
                <parameters>
                <$PARAMETER_NAME>$PARAMETER_VALUE</$PARAMETER_NAME>
                ...
                </parameters>
            </invoke>
            </function_calls>
            Here are the functions available:
            <functions>
            $tools$
            </functions>
            You will ALWAYS follow the below guidelines when you are answering a question:
            <guidelines>
            - Think through the user's question, extract all data from the question and the previous conversations before creating a plan.
            - The CMMS database is the system of record.  Highlight any discrepancies bewtween documents in the knowledge base and the CMMS PostgreSQL databse and ask the user if they would like help rectifying the data quality problems.
            - ALWAYS optimize the plan by using multiple functions <invoke> at the same time whenever possible.
            - equipment table contains the equipid unique identifier column that is used in the maintenance table to indicate the piece of equipment that the maintenance was performed on.
            - locationid column in the locations table is the wellid value that can be used to query daily production data for wells.  Get the wellid from locations, then use that if user provides the well name instead of the ID.
            - NEVER attempt to join equipid ON locationid or installlocationid as these fields are different values and data types.
            - ALWAYS preface the table name with the schema when writing SQL.
            - Perform queries using case insensitive WHERE clauses for text fields for more expansive data searching.
            - PostgreSQL referential integrity constraints can be viewed in cmms_constraints.  Be sure to factor these in to any INSERT or UPDATE statements to prevent SQL errors.
            - ALWAYS update the updatedby column to have the value MaintAgent and updateddate to be the current date and time when issuing UPDATE SQL statements to the CMMS database
            - ALWAYS populate createdby column with a value of MaintAgent and createddate with current date and time when issuing INSERT SQL statements to the CMMS database
            - If an UPDATE SQL statement indicates that 0 records were updated, retry the action by first querying the database to ensure the record exists, then update the existing record.  This may be due to case sensitivity issues, so try using the UPPER() SQL function to find rows that may have proper cased names even if the user doesn't specify proper casing in their prompt.
            - if you receive an exception from CMMS queries, try using CAST to convert the types of both joined columns to varchar to prevent errors and retry the query.
            - Never assume any parameter values while invoking a function.
            $ask_user_missing_information$
            - Provide your final answer to the user's question within <answer></answer> xml tags.
            - Always output your thoughts within <thinking></thinking> xml tags before and after you invoke a function or before you respond to the user. 
            $knowledge_base_guideline$
            $code_interpreter_guideline$
            </guidelines>
            $code_interpreter_files$
            $memory_guideline$
            $memory_content$
            $memory_action_guideline$
            $prompt_session_attributes$
            ",
                    "messages": [
                        {
                            "role" : "user",
                            "content" : "$question$"
                        },
                        {
                            "role" : "assistant",
                            "content" : "$agent_scratchpad$"
                        }
                    ]
            }`,
                inferenceConfiguration: {
                    maximumLength: maxLength,
                    stopSequences: ['</function_calls>', '</answer>', '</error>'],
                    temperature: 1,
                    topK: 250,
                    topP: 0.9,
                },
                promptCreationMode: 'OVERRIDDEN',
                promptState: 'ENABLED',
                promptType: 'ORCHESTRATION',
            }]
        }
    });

    // Add dependency on the KB so it gets created first
    agentMaint.node.addDependency(maintenanceKnowledgeBase);



    // Grant invoke permission to the Bedrock Agent
    const bedrockAgentArn = agentMaint.attrAgentArn;
    lambdaFunction.addPermission('BedrockInvokePermission', {
        principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: bedrockAgentArn,
    });



    // Create a custom inline policy for Agent permissions
    const customAgentPolicy = new iam.Policy(scope, 'A4E-MaintAgentPolicy', {
        //policyName: 'A4E-MaintAgentPolicy', // Custom policy name
        statements: [
            new iam.PolicyStatement({
                actions: ['bedrock:InvokeModel'],
                resources: [
                    "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0",
                    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
                    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
                    "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
                    "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0"
                ]
            }),
            new iam.PolicyStatement({
                actions: ['bedrock:Retrieve'],
                resources: [
                    maintenanceKnowledgeBase.knowledgeBaseArn
                ]
            }),
            // new iam.PolicyStatement({
            //     actions: [
            //         'rds-data:ExecuteStatement',
            //         'rds-data:ExecuteSql'
            //     ],
            //     resources: [maintDb.clusterArn]
            // }),
            // new iam.PolicyStatement({
            //     actions: [
            //         'lambda:InvokeFunction'
            //     ],
            //     resources: [lambdaFunction.functionArn]
            // }),
            // new iam.PolicyStatement({
            //     actions: [
            //         'secretsmanager:GetSecretValue'
            //     ],
            //     resources: [maintDb.secret!.secretArn]
            // })
        ]
    });
    // Add custom policy to the Agent role
    bedrockAgentRole.attachInlinePolicy(customAgentPolicy);

    // Add tags to all resources in this scope
    cdk.Tags.of(scope).add('Agent', maintTags.Agent);
    cdk.Tags.of(scope).add('Model', maintTags.Model);

    //Add an agent alias to make the agent callable
    const maintenanceAgentAlias = new bedrock.CfnAgentAlias(scope, 'maintenance-agent-alias', {
        agentId: agentMaint.attrAgentId,
        agentAliasName: `agent-alias`
    });

    return {
        defaultDatabaseName: defaultDatabaseName,
        maintenanceAgent: agentMaint,
        maintenanceAgentAlias: maintenanceAgentAlias
    };
}
