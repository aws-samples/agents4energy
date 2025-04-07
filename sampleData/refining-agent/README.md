# Refining Agent Sample Data

## Overview
This directory contains sample data for the Refining Agent, designed to demonstrate how AI agents can help refinery operators troubleshoot process issues, optimize operations, and make better data-driven decisions through natural language queries.

## Directory Structure

- **process-diagrams/**: Contains descriptions of refinery process units like crude distillation
- **equipment/**: Documentation on refinery equipment such as heat exchangers
- **optimization/**: Information on optimization strategies for refinery operations
- **operations-data/**: Time-series process data from refinery units showing real operational patterns
- **anomalies/**: Analyses of process anomalies and incidents with root cause explanations
- **process-control/**: Database schema and data for control systems and performance metrics
- **troubleshooting/**: Guides for troubleshooting common refinery problems

## Use Cases

The Refining Agent sample data enables plant operators to:

1. **Analyze Process Upsets**: Identify root causes of alarms and abnormal conditions
   - Example: "What caused the high temperature alarms in the CDU on April 3rd?"

2. **Troubleshoot Equipment Issues**: Get guidance on equipment problems and solutions
   - Example: "Explain the main reasons for FCC catalyst circulation problems and how to troubleshoot them" 

3. **Optimize Operation**: Find ways to improve refinery efficiency
   - Example: "How do I optimize crude preheat train efficiency in the refinery?"

4. **Understand Process Changes**: Learn how different process variables interact during transitions
   - Example: "Analyze the process data from CDU-101 during the crude oil switch on April 3rd"

5. **Assess Control Performance**: Evaluate how well control loops are functioning
   - Example: "Show me the key performance indicators for control loops in CDU-101"

## Data Formats

- **JSON**: Time-series process data (operations-data/)
- **Markdown**: Documentation and reference materials
- **SQL**: Database schema and sample data for process control

## Integration with Knowledge Base

This sample data is designed to be loaded into a knowledge base that the Refining Agent can access. The agent uses this knowledge to provide context-aware responses to operator queries, helping them make better decisions without having to search through multiple systems or documents.

## Extending the Dataset

To add more data:

1. Follow similar formats to the existing files
2. Ensure new data connects to existing concepts and process units
3. Include realistic process values and scenarios that refinery operators would encounter
4. Add relevant anomalies and troubleshooting examples for common problems

The goal is to demonstrate how natural language queries can democratize access to complex refinery data, enabling operators to get insights without specialized database or programming knowledge. 