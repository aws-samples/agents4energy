// import { BedrockAgent } from "@aws-sdk/client-bedrock-agent"
import outputs from '@/../amplify_outputs.json';

type BaseAgent = {
    name: string
    samplePrompts: string[]
    source: 'bedrockAgent' | 'graphql'
}

export type BedrockAgent = BaseAgent & {
    source: "bedrockAgent"
    agentId: string
    agentAliasId: string
}

export type LangGraphAgent = BaseAgent & {
    source: "graphql"
    invokeFieldName: string
}

// Helper function to safely get agent IDs directly from amplify outputs
const getAgentId = (agentKey: string) => {
    try {
        const customKey = `${agentKey}AgentId`;
        if (outputs.custom && customKey in outputs.custom) {
            return outputs.custom[customKey as keyof typeof outputs.custom] as string;
        }
        return '';
    } catch (e) {
        console.warn(`Failed to get agentId for ${agentKey}:`, e);
        return '';
    }
};

// Helper function to safely get agent alias IDs directly from amplify outputs
const getAgentAliasId = (agentKey: string) => {
    try {
        const customKey = `${agentKey}AgentAliasId`;
        if (outputs.custom && customKey in outputs.custom) {
            return outputs.custom[customKey as keyof typeof outputs.custom] as string;
        }
        return '';
    } catch (e) {
        console.warn(`Failed to get agentAliasId for ${agentKey}:`, e);
        return '';
    }
};

export const defaultAgents: { [key: string]: BaseAgent | BedrockAgent | LangGraphAgent } = {
    PlanAndExecuteAgent: {
        name: `Production Agent`,
        source: `graphql`,
        invokeFieldName: 'getPlanAndExecuteResponse',
        samplePrompts: [
            `This morning well with API number 30-045-29202 stopped producing gas with indication of a hole in tubing.  
            Make a table of all operational events found in the well files. 
            Query all historic monthly production rates and make a plot with both the event and production data. 
            Estimate the value of the well's remaining production. 
            Write a procedure to repair the well, estimate the cost of the repair, and calculate financial metrics. 
            Make an executive report about repairing the well with detailed cost and procedure data. 
            Use the ai role for all steps.
            `.replace(/^\s+/gm, ''),
            `Search the well files for the well with API number 30-045-29202 to make a table with type of operation (drilling, completion, workover, plugging, other), text from the report describing operational details, and document title.
            Also execute a sql query to get the total monthly oil, gas and water production from this well.
            Create a plot with both the event data and the production data. `.replace(/^\s+/gm, ''), //This trims the white space at the start of each line
            `Plot the total monthly oil, gas, and water production since 1900 for the well with API number 30-045-29202`,
            `Which form of artifical lift best matches my personality?`
        ]
    } as LangGraphAgent,
    MaintenanceAgent: {
        name: "Maintenance Agent",
        source: "bedrockAgent",
        agentId: getAgentId('maintenance'),
        agentAliasId: getAgentAliasId('maintenance'),
        samplePrompts: [
            "How many tanks are in my biodiesel unit?",
            "In September 2024, what are a few key incidents and actions taken at the biodiesel unit?",
        ],
    } as BedrockAgent,
    RegulatoryAgent: {
        name: "Regulatory Agent",
        source: "bedrockAgent",
        agentId: getAgentId('regulatory'),
        agentAliasId: getAgentAliasId('regulatory'),
        samplePrompts: [
            "What are the requirements for fugitive emissions monitoring and reporting in the U.S.?",
            "What are the requirements for decomissioning an offshore oil well in Brazil?",
        ],
    } as BedrockAgent,
    PetrophysicsAgent: {
        name: "Petrophysics Agent",
        source: "bedrockAgent",
        agentId: getAgentId('petrophysics'),
        agentAliasId: getAgentAliasId('petrophysics'),
        samplePrompts: [
            "Give me a summary fluid substitution modeling",
            "Give me the inputs of Gassmann equation",
            "What are AVO classes?",
            "Calculate the intercept and gradient value of the wet sandstone with vp=3.5 km/s, vs=1.95 km/s, bulk density=2.23 gm/cc when it is overlain by a shale? Determine the AVO class.",
            "A wet sandstone has vp=3.5 km/s, vs=1.95 km/s, bulk density=2.23 gm/cc. What are the expected seismic velocities of the sandstone if the desired ﬂuid saturation is 80% oil? Use standard assumptions."
        ],
    } as BedrockAgent,
    RefiningAgent: {
        name: "Refining Agent",
        source: "bedrockAgent",
        agentId: getAgentId('refining'),
        agentAliasId: getAgentAliasId('refining'),
        samplePrompts: [
            "What are the main processes in crude oil refining?",
            "How does a fluid catalytic cracking unit work?",
            "What are the key safety considerations in refinery operations?"
        ],
    } as BedrockAgent,
    LandAgent: {
        name: "Land Agent",
        source: "bedrockAgent",
        agentId: getAgentId('land'),
        agentAliasId: getAgentAliasId('land'),
        samplePrompts: [
            "What are the key components of an oil and gas lease?",
            "How do I calculate royalty payments for mineral rights owners?",
            "What is the difference between fee simple and severed mineral rights?"
        ],
    } as BedrockAgent,
    SafetyAgent: {
        name: "Safety Agent",
        source: "bedrockAgent",
        agentId: getAgentId('safety'),
        agentAliasId: getAgentAliasId('safety'),
        samplePrompts: [
            "What are the OSHA requirements for confined space entry?",
            "How do I conduct a proper job safety analysis?",
            "What PPE is required for handling hydrogen sulfide?"
        ],
    } as BedrockAgent,
    DrillingAgent: {
        name: "Drilling Agent",
        source: "bedrockAgent",
        agentId: getAgentId('drilling'),
        agentAliasId: getAgentAliasId('drilling'),
        samplePrompts: [
            "What are the components of a drilling mud system?",
            "How do I calculate the required mud weight to control formation pressure?",
            "What are the best practices for directional drilling?"
        ],
    } as BedrockAgent,
    TradingAgent: {
        name: "Trading Agent",
        source: "bedrockAgent",
        agentId: getAgentId('trading'),
        agentAliasId: getAgentAliasId('trading'),
        samplePrompts: [
            "How do crude oil futures contracts work?",
            "What factors affect natural gas pricing?",
            "How can I hedge against price volatility in energy markets?"
        ],
    } as BedrockAgent,
    FinanceAgent: {
        name: "Finance Agent",
        source: "bedrockAgent",
        agentId: getAgentId('finance'),
        agentAliasId: getAgentAliasId('finance'),
        samplePrompts: [
            "How do I calculate the net present value of an oil well?",
            "What are the key financial metrics for evaluating energy projects?",
            "How do I account for depletion in oil and gas financial statements?"
        ],
    } as BedrockAgent,
    LogisticsAgent: {
        name: "Logistics Agent",
        source: "bedrockAgent",
        agentId: getAgentId('logistics'),
        agentAliasId: getAgentAliasId('logistics'),
        samplePrompts: [
            "What are the main methods for transporting crude oil?",
            "How do I optimize my supply chain for oilfield equipment?",
            "What regulations apply to hazardous materials transportation in the energy sector?"
        ],
    } as BedrockAgent,
    DecarbAgent: {
        name: "Decarbonization Agent",
        source: "bedrockAgent",
        agentId: getAgentId('decarb'),
        agentAliasId: getAgentAliasId('decarb'),
        samplePrompts: [
            "What are the main carbon capture technologies available today?",
            "How can I reduce emissions in my oil and gas operations?",
            "What are the economics of blue vs. green hydrogen production?"
        ],
    } as BedrockAgent
}
