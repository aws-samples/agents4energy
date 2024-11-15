type defaultAgent = {
    name: string,
    samplePrompts: string[]
}

export const defaultAgents: { [key: string]: defaultAgent } = {
    ProductionAgent: {
        name: "Production Agent",
        samplePrompts: [
            `I'm making an operational history for a well with API number 30-045-29202. 
            The history should show events like drilling the well, completing a zone, repairing artificial lift, and other events which impact the wellbore. 
            Make a table showing the type of operation, text from the report describing operational details, and document title. 
            Exclude information about changes in the transportation corporation or cathotic protection.`,
            `Execute a SQL query and plot the result to get the total monthly oil, gas, and water production since 1990.`
        ]
    },
    FoundationModel: {
        name: "Foundation Model",
        samplePrompts: [
            "What portion of world oil production does the US produce?"
        ]
    },
}