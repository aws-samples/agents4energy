type defaultAgent = {
    name: string,
    samplePrompts: string[]
}

export const defaultAgents: { [key: string]: defaultAgent } = {
    ProductionAgent: {
        name: "Production Agent",
        samplePrompts: [
            `Search the well files for the well with API number 30-045-29202 to make a table with type of operation (drilling, completion, workover, plugging, other), text from the report describing operational details, and document title.
            Also execute a sql query to get the total monthly oil, gas and water production from this well.
            Create a plot with both the event data and the production data. `.replace(/^\s+/gm, ''), //This trims the white space at the start of each line
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