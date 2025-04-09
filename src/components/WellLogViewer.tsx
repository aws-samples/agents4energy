import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { 
  Box, 
  Typography, 
  Select, 
  MenuItem, 
  FormControl, 
  InputLabel, 
  Grid, 
  Paper,
  TextField,
  Slider,
  IconButton,
  Tooltip,
  Chip,
  SelectChangeEvent
} from '@mui/material';
import { 
  Download as DownloadIcon,
  Info as InfoIcon
} from '@mui/icons-material';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface WellLogViewerProps {
  lasData: string;
  wellName: string;
}

interface LogCurve {
  name: string;
  unit: string;
  values: number[];
  depth: number[];
}

interface WellInfo {
  [key: string]: string;
}

const WellLogViewer: React.FC<WellLogViewerProps> = ({ lasData, wellName }) => {
  const [curves, setCurves] = useState<LogCurve[]>([]);
  const [selectedCurves, setSelectedCurves] = useState<string[]>(['GR', 'RHOB', 'NPHI']);
  const [availableCurves, setAvailableCurves] = useState<string[]>([]);
  const [wellInfo, setWellInfo] = useState<WellInfo>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [depthRange, setDepthRange] = useState<[number, number]>([0, 0]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showWellInfo, setShowWellInfo] = useState<boolean>(false);

  const parseLasData = React.useCallback(() => {
    try {
      setLoading(true);
      setError(null);
      
      // Split the LAS file into sections
      const sections = lasData.split('~');
      
      // Parse well information
      const wellInfoSection = sections.find(section => section.startsWith('W'));
      if (wellInfoSection) {
        const wellInfoLines = wellInfoSection.split('\n').slice(1);
        const wellInfoData: WellInfo = {};
        
        wellInfoLines.forEach(line => {
          if (line.trim()) {
            const [mnemonic, value] = line.split(':').map(part => part.trim());
            if (mnemonic && value) {
              wellInfoData[mnemonic] = value;
            }
          }
        });
        
        setWellInfo(wellInfoData);
      }
      
      // Parse curve information
      const curveInfoSection = sections.find(section => section.startsWith('C'));
      if (curveInfoSection) {
        const curveInfoLines = curveInfoSection.split('\n').slice(1);
        const curveNames: string[] = [];
        
        curveInfoLines.forEach(line => {
          if (line.trim()) {
            const parts = line.split('.').map(part => part.trim());
            if (parts.length >= 2) {
              const curveName = parts[0];
              if (curveName && !curveName.includes('MNEM') && !curveName.includes('UNIT')) {
                curveNames.push(curveName);
              }
            }
          }
        });
        
        setAvailableCurves(curveNames);
      }
      
      // Parse log data
      const logDataSection = sections.find(section => section.startsWith('A'));
      if (logDataSection) {
        const logDataLines = logDataSection.split('\n').slice(1);
        const depthValues: number[] = [];
        const curveValues: Record<string, number[]> = {};
        
        // Initialize curve arrays
        availableCurves.forEach(curve => {
          curveValues[curve] = [];
        });
        
        logDataLines.forEach(line => {
          if (line.trim()) {
            const values = line.split(/\s+/).map(val => {
              const num = parseFloat(val);
              return isNaN(num) ? 0 : num;
            });
            if (values.length > 0) {
              depthValues.push(values[0]);
              
              // Map values to curves
              availableCurves.forEach((curve, index) => {
                if (values[index + 1] !== undefined) {
                  curveValues[curve].push(values[index + 1]);
                }
              });
            }
          }
        });
        
        // Set depth range
        if (depthValues.length > 0) {
          setDepthRange([Math.min(...depthValues), Math.max(...depthValues)]);
        }
        
        // Create curve objects
        const parsedCurves: LogCurve[] = availableCurves.map(curve => ({
          name: curve,
          unit: getCurveUnit(curve),
          values: curveValues[curve],
          depth: depthValues
        }));
        
        setCurves(parsedCurves);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error parsing LAS data:', err);
      setError('Failed to parse LAS data. Please check the file format.');
      setLoading(false);
    }
  }, [lasData, availableCurves]);

  useEffect(() => {
    parseLasData();
  }, [lasData, parseLasData]);

  const getCurveUnit = (curveName: string): string => {
    switch (curveName) {
      case 'GR': return 'GAPI';
      case 'CALI': return 'IN';
      case 'DT': return 'US/M';
      case 'RHOB': return 'K/M3';
      case 'NPHI': return 'V/V';
      case 'ILD': return 'OHMM';
      case 'ILM': return 'OHMM';
      case 'SP': return 'MV';
      default: return '';
    }
  };

  const handleCurveSelection = (event: SelectChangeEvent<string[]>) => {
    setSelectedCurves(event.target.value as string[]);
  };

  const handleDepthRangeChange = (_event: Event, newValue: number | number[]) => {
    if (Array.isArray(newValue) && newValue.length === 2) {
      setDepthRange([newValue[0], newValue[1]]);
    }
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const filteredCurves = availableCurves.filter(curve => 
    curve.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const createPlotlyTraces = () => {
    const traces = selectedCurves.map(curveName => {
      const curve = curves.find(c => c.name === curveName);
      if (!curve) return null;
      
      // Filter data based on depth range
      const filteredData = curve.depth.map((depth, index) => ({
        depth,
        value: curve.values[index]
      })).filter(point => 
        point.depth >= depthRange[0] && point.depth <= depthRange[1]
      );
      
      return {
        x: filteredData.map(point => point.value || 0),
        y: filteredData.map(point => point.depth),
        name: `${curve.name} (${curve.unit})`,
        type: 'scatter',
        mode: 'lines',
        line: {
          width: 1
        }
      } as const;
    }).filter((trace): trace is NonNullable<typeof trace> => trace !== null);
    
    return traces;
  };

  const createPlotlyLayout = () => {
    return {
      title: `${wellName} - Well Logs`,
      xaxis: {
        title: 'Value',
        side: 'top'
      },
      yaxis: {
        title: 'Depth (m)',
        autorange: 'reversed',
        range: [depthRange[1], depthRange[0]] as [number, number]
      },
      height: 600,
      showlegend: true,
      legend: {
        orientation: 'h',
        y: -0.2
      },
      margin: {
        l: 50,
        r: 50,
        t: 50,
        b: 100
      }
    } as const;
  };

  const handleExport = () => {
    // Create CSV content
    const headers = ['Depth', ...selectedCurves.map(curve => `${curve} (${getCurveUnit(curve)})`)];
    const rows = curves[0].depth.map((depth, index) => {
      const row: (number | string)[] = [depth];
      selectedCurves.forEach(curveName => {
        const curve = curves.find(c => c.name === curveName);
        row.push(curve ? curve.values[index] : '');
      });
      return row.join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wellName}_logs.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Typography>Loading well log data...</Typography>;
  }

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  if (curves.length === 0) {
    return <Typography>No well log data available.</Typography>;
  }

  return (
    <Paper elevation={3} sx={{ p: 2, mb: 2 }}>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">{wellName}</Typography>
            <Box>
              <Tooltip title="Show Well Information">
                <IconButton onClick={() => setShowWellInfo(!showWellInfo)}>
                  <InfoIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Export Data">
                <IconButton onClick={handleExport}>
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
          
          {showWellInfo && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Well Information</Typography>
              <Grid container spacing={1}>
                {Object.entries(wellInfo).map(([key, value]) => (
                  <Grid item xs={12} sm={6} md={4} key={key}>
                    <Chip 
                      label={`${key}: ${value}`}
                      variant="outlined"
                      size="small"
                      sx={{ m: 0.5 }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}
        </Grid>
        
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Search Curves"
            variant="outlined"
            value={searchTerm}
            onChange={handleSearchChange}
            sx={{ mb: 2 }}
          />
        </Grid>
        
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Select Curves</InputLabel>
            <Select
              multiple
              value={selectedCurves}
              onChange={handleCurveSelection}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as string[]).map((value) => (
                    <Chip key={value} label={value} />
                  ))}
                </Box>
              )}
            >
              {filteredCurves.map((curve) => (
                <MenuItem key={curve} value={curve}>
                  {curve} ({getCurveUnit(curve)})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        
        <Grid item xs={12}>
          <Typography gutterBottom>Depth Range (m)</Typography>
          <Slider
            value={depthRange}
            onChange={handleDepthRangeChange}
            valueLabelDisplay="auto"
            min={Math.min(...curves[0].depth)}
            max={Math.max(...curves[0].depth)}
          />
        </Grid>
        
        <Grid item xs={12}>
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <Plot
              data={createPlotlyTraces()}
              layout={createPlotlyLayout()}
              config={{ 
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToAdd: ['drawopenpath', 'eraseshape'],
                modeBarButtonsToRemove: ['lasso2d']
              }}
              style={{ width: '100%', minHeight: '600px' }}
            />
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default WellLogViewer; 