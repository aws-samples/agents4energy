# CDU-101 High Column Temperature Incident Analysis

## Incident Summary
- **Date:** April 3, 2024
- **Time:** 06:30 - 07:15
- **Unit:** Crude Distillation Unit (CDU-101)
- **Issue:** Escalating temperatures throughout the column, particularly at the top (TI-104) and bottom (TI-105)
- **Severity:** Medium (Operational constraint violation without equipment damage)
- **Resolution Time:** 45 minutes

## Timeline of Events

| Timestamp | Event |
|-----------|-------|
| 05:30 | Crude oil source changed from Nigerian Bonny Light to Saudi Arabian Light |
| 06:00 | First signs of temperature increase at column bottom (TI-105) |
| 06:15 | Continued rise in temperatures, top of column (TI-104) beginning to show upward trend |
| 06:30 | Column bottom temperature exceeds normal range |
| 06:45 | High temperature alarm at column bottom (TI-105) |
| 07:00 | Multiple high temperature and pressure alarms |
| 07:15 | Reflux pump PM-102A exhibits abnormal vibration, switched to PM-102B |
| 07:30 | Column temperatures begin trending back to normal range |

## Process Variable Deviations

| Tag | Description | Normal Range | Peak Value | Deviation % |
|-----|-------------|--------------|------------|-------------|
| TI-103 | Furnace outlet temperature | 340-360°C | 362.9°C | +0.8% |
| TI-104 | Column top temperature | 115-125°C | 125.3°C | +0.2% |
| TI-105 | Column bottom temperature | 360-375°C | 377.9°C | +0.8% |
| PI-102 | Column top pressure | 1.0-1.3 bar | 1.35 bar | +3.8% |
| FI-101 | Crude feed flow rate | 380-420 m³/h | 419.6 m³/h | -0.1% |
| LI-102 | Reflux drum level | 40-60% | 55.8% | -7.0% |
| AI-101 | Feed API gravity | 32-36 °API | 32.7 °API | -0% |

## Root Cause Analysis

### Direct Cause
The primary cause of the high column temperatures was determined to be the change in crude oil properties following the switch from Nigerian Bonny Light to Saudi Arabian Light crude. The Saudi crude is heavier (lower API gravity) and contains more components in the middle distillate range.

### Contributing Factors

1. **Crude Oil Characterization:**
   - The new crude had a different boiling point distribution
   - Heavy fraction content was 3.5% higher than previous crude
   - Preheater and furnace duties were not adjusted immediately for the new crude

2. **Control System Response:**
   - Operating parameters were not updated in the DCS for the new crude
   - Temperature controller TIC-104 was reaching output saturation

3. **Operational Factors:**
   - Insufficient preparation time for crude switch procedure
   - Delayed adjustment of reflux ratios
   - Pre-planning did not account for potential pump issues with heavier crude

### System Breakdown
The change in crude feed properties led to:
1. Different component distribution in the column
2. Increased heat load on reflux system
3. Higher bottom temperature due to heavier components
4. Increased pump vibration due to different fluid properties

## Corrective Actions

### Immediate Actions Taken
1. Adjusted reflux ratio to control overhead temperature
2. Switched to backup reflux pump (PM-102B)
3. Slightly reduced furnace firing rate
4. Fine-tuned product draw rates to match new crude properties

### Recommended Actions for Future Prevention
1. **Process Control Improvements:**
   - Develop feed-forward control strategy based on crude assay data
   - Implement dynamic setpoint adjustment based on feed properties
   - Configure conditional alarms based on crude type

2. **Operational Procedures:**
   - Create specific operating procedures for different crude types
   - Develop detailed crude transition procedure
   - Include pump monitoring in crude transition checklist

3. **Training:**
   - Train operators on managing crude transitions
   - Conduct simulation exercises for feed property changes
   - Review alarm response procedures

4. **Engineering Modifications:**
   - Evaluate reflux pump impeller design for compatibility with range of crude types
   - Review control valve sizing for adequate turndown
   - Consider additional instrumentation for rapid crude property detection

## Learnings and Observations

### Key Insights
1. Crude oil property changes had greater impact on column hydraulics than anticipated
2. Multiple alarms occurring simultaneously made troubleshooting challenging
3. Correlation between bottom temperature and reflux pump performance not immediately obvious
4. Historical data review showed subtle warning signs 30 minutes before first alarm

### Pattern Recognition Opportunities
Historical data analysis revealed that the following pattern typically precedes similar events:
1. Crude API gravity drops by >1.0 points
2. Bottom temperature rises steadily for >30 minutes
3. Reflux flow slightly unstable with minor oscillations
4. Small pressure increase at column bottom

### AI-Assisted Analysis Opportunities
An AI agent could help:
1. Predict column behavior based on crude property changes
2. Identify subtle correlations between variables
3. Recommend optimal controller setpoints for different crude types
4. Detect early warning patterns before conventional alarms trigger
5. Generate "what-if" scenarios for operator decision support 