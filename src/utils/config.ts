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
            `Plot the total monthly oil, gas, and water production since 1900 for the well with API number 30-045-29202`
        ]
    },
    FoundationModel: {
        name: "Foundation Model",
        samplePrompts: [
            "What portion of world oil production does the US produce?"
        ]
    },
    PlanAndExecuteAgent: {
        name: "Plan And Execute",
        samplePrompts: [
            `The well with API number 30-045-29202 recently fell in production to 10 MCFD with indication of a hole in tubing at 1000'. 
            Search the well files and make a table of operational events. 
            Based on that make a procedure to repair the well, estimate the cost of the repair, plot the historic production rates with operational events, and forecast the financial returns. 
            Use the ai role for all of the steps.
            `.replace(/^\s+/gm, ''),
            `What is the hometown of the 2015 Australian open winner?`,
            `Where should I go on vacation?`
        ]
    },
}