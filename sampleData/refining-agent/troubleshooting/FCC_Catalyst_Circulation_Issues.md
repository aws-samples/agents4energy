# Fluid Catalytic Cracking (FCC) Unit Catalyst Circulation Troubleshooting Guide

## Introduction

This guide addresses common catalyst circulation problems in the FCC unit. Proper catalyst circulation is critical for:
- Maintaining desired conversion rates
- Ensuring heat balance in the unit
- Preventing catalyst deactivation
- Avoiding equipment damage

## Common Catalyst Circulation Problems

### 1. Low Catalyst Circulation Rate

#### Symptoms
- Decreased differential pressure across the regenerator
- Lower regenerator temperature
- Decreased conversion in the riser
- Increased slurry oil yield
- Lower pressure build in standpipe

#### Potential Causes and Solutions

| Possible Cause | Diagnostic Indicators | Corrective Actions |
|----------------|------------------------|-------------------|
| **Slide valve mechanical issue** | • Movement deviation between valve actuator and actual position<br>• Unusual noise during operation | • Check valve stem for binding<br>• Inspect valve body for catalyst build-up<br>• Verify valve seating |
| **Aeration failure** | • Low aeration flow rate<br>• Uneven or unstable catalyst flow<br>• Fluctuating standpipe density | • Check aeration air flow rates and distribution<br>• Verify aeration compressor operation<br>• Inspect aeration ring for plugging |
| **Catalyst bridging in hopper** | • Sudden drop in circulation<br>• Large pressure fluctuations in standpipe | • Increase aeration to break bridge<br>• Apply acoustic vibrators if installed<br>• Consider emergency shutdown if severe |
| **Catalyst properties issue** | • Increased catalyst attrition<br>• Unusual catalyst size distribution<br>• Catalyst deactivation signs | • Sample and analyze catalyst properties<br>• Evaluate catalyst addition/withdrawal rates<br>• Consider fresh catalyst addition |

### 2. Unstable Catalyst Circulation

#### Symptoms
- Fluctuating differential pressures
- Surging catalyst flow
- Erratic reactor/regenerator temperatures
- Fluctuating product yields

#### Potential Causes and Solutions

| Possible Cause | Diagnostic Indicators | Corrective Actions |
|----------------|------------------------|-------------------|
| **Inadequate aeration** | • Erratic density profile in standpipe<br>• Fluctuating aeration pressure | • Adjust aeration distribution<br>• Check for plugged aeration nozzles<br>• Verify even distribution of aeration |
| **Improper slide valve control** | • Hunting in valve position<br>• Control loop oscillation | • Tune PID controller parameters<br>• Check for valve stiction<br>• Verify instrument air quality |
| **Feed quality/rate changes** | • Correlation with feed rate changes<br>• Feed composition variations | • Implement feed rate ramp limits<br>• Add feed quality control steps<br>• Consider feed blending strategies |
| **Regenerator airflow issues** | • Air grid differential pressure fluctuations<br>• Uneven temperature profile in regenerator | • Check for plugged air grid nozzles<br>• Adjust air distribution<br>• Inspect for refractory damage |

### 3. Catalyst Entrainment/Losses

#### Symptoms
- High cyclone pressure drops
- Increased catalyst makeup requirement
- Catalyst in main fractionator
- Elevated opacity in regenerator flue gas

#### Potential Causes and Solutions

| Possible Cause | Diagnostic Indicators | Corrective Actions |
|----------------|------------------------|-------------------|
| **Cyclone damage** | • Sudden increase in catalyst losses<br>• Change in cyclone pressure drop | • Inspect cyclones during next turnaround<br>• Check cyclone diplegs for proper operation<br>• Consider temporary reduction in throughput |
| **Excessive riser velocity** | • Correlation with throughput increases<br>• High riser top temperature | • Reduce feed rate<br>• Adjust catalyst circulation rate<br>• Verify feed nozzle operation |
| **Dipleg flooding** | • Fluctuating cyclone pressure drops<br>• Unusual regenerator bed level variations | • Check dipleg aeration<br>• Verify trickle valve operation<br>• Inspect for mechanical damage |
| **Catalyst fines generation** | • Gradual increase in losses over time<br>• Small particle size in lost catalyst | • Evaluate catalyst quality<br>• Adjust withdrawal/addition rates<br>• Review unit operating severity |

## Diagnostic Tools and Techniques

### Key Measurements for Troubleshooting

| Measurement | Normal Range | What It Tells You |
|-------------|--------------|-------------------|
| Regenerator ΔP | 20-25 kPa | Catalyst inventory and bed density |
| Standpipe density | 650-720 kg/m³ | Aeration effectiveness and flow quality |
| Slide valve position | 15-70% | Operating margin and control range |
| Catalyst circulation rate | 15-25 tons/min | Unit throughput and conversion capacity |
| Cyclone pressure drop | 10-15 kPa | Cyclone efficiency and potential damage |
| Temperature profile | <50°C variation | Even fluidization and combustion |

### Advanced Diagnostic Methods

1. **Catalyst Circulation Density Profile**
   - Measuring density at different elevations
   - Indicates fluidization quality and potential bridging

2. **Pressure Profile Analysis**
   - Mapping pressure distribution throughout circulation loop
   - Helps identify flow restrictions and aeration issues

3. **Radioactive Tracer Studies**
   - Measuring residence time distribution
   - Identifies stagnant zones or shortcuts

4. **Acoustic Monitoring**
   - Detecting unusual flow sounds
   - Early indicator of circulation problems

## Emergency Response Actions

### For Severe Circulation Loss

1. Reduce feed rate immediately by 20-50%
2. Increase standpipe aeration to maximum
3. Check and increase regenerator bed level if low
4. Verify all slide valve positions and operations
5. Prepare for potential unit shutdown if circulation cannot be restored

### For Excessive Entrainment

1. Reduce air rates to regenerator
2. Lower catalyst circulation
3. Reduce feed preheat to decrease riser velocity
4. Monitor downstream equipment for catalyst contamination
5. Increase catalyst fines removal system operation

## Preventive Measures

1. **Regular Maintenance**
   - Schedule routine inspection of slide valves
   - Check aeration system components
   - Verify instrument calibration

2. **Operating Practices**
   - Establish catalyst property control program
   - Implement feed quality monitoring
   - Train operators on circulation control

3. **Design Considerations**
   - Evaluate standpipe design improvements
   - Consider enhanced aeration systems
   - Implement advanced control strategies

## Typical Process Variable Correlations

| Variable 1 | Variable 2 | Normal Relationship | Abnormal Pattern Indicates |
|------------|------------|---------------------|----------------------------|
| Regenerator ΔP | Catalyst circulation | Direct correlation | Potential catalyst loss or circulation problems |
| Riser temperature | Regenerator temperature | Inverse correlation | Heat balance issues or coking |
| Standpipe level | Slide valve position | Inverse correlation | Valve problems or aeration issues |
| Air flow | Regenerator temperature | Direct correlation | Potential air grid plugging or catalyst quality issues |
| Feed rate | Catalyst circulation | Direct correlation | Control system issues or mechanical problems |

## Historical Case Studies

### Case 1: Severe Catalyst Circulation Loss During Storm
A Gulf Coast refinery experienced sudden catalyst circulation loss during a thunderstorm. Investigation revealed water intrusion into the instrument air system affecting aeration control. The unit required emergency shutdown. Corrective actions included improved air dryer systems and weather protection for critical components.

### Case 2: Gradual Circulation Decline Over Weeks
A European refinery noted steadily declining catalyst circulation despite increasing slide valve openings. Analysis showed catalyst contamination with iron and nickel from crude unit corrosion products. The solution involved temporary catalyst withdrawal and fresh catalyst addition, plus implementation of a metal passivation program in the crude unit.

### Case 3: Cyclical Circulation Instability
An Asian refinery experienced regular 2-hour cycles of catalyst circulation fluctuation. Advanced diagnostics revealed the circulation control was interacting with the regenerator temperature control. Retuning both control loops with different response times resolved the issue. 