/**
 * Utility functions for handling LAS (Log ASCII Standard) files
 */

/**
 * Fetches a LAS file from the server
 * @param filePath Path to the LAS file
 * @returns Promise with the file content as string
 */
export const fetchLasFile = async (filePath: string): Promise<string> => {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch LAS file: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error('Error fetching LAS file:', error);
    throw error;
  }
};

/**
 * Parses a LAS file string into a structured object
 * @param lasContent LAS file content as string
 * @returns Parsed LAS data
 */
export const parseLasFile = (lasContent: string) => {
  try {
    // Split the LAS file into sections
    const sections = lasContent.split('~');
    
    // Parse version information
    const versionSection = sections.find(section => section.startsWith('V'));
    const versionInfo: Record<string, string> = {};
    if (versionSection) {
      const versionLines = versionSection.split('\n').slice(1);
      versionLines.forEach(line => {
        if (line.trim()) {
          const [key, value] = line.split(':').map(part => part.trim());
          if (key && value) {
            versionInfo[key] = value;
          }
        }
      });
    }
    
    // Parse well information
    const wellInfoSection = sections.find(section => section.startsWith('W'));
    const wellInfo: Record<string, string> = {};
    if (wellInfoSection) {
      const wellInfoLines = wellInfoSection.split('\n').slice(1);
      wellInfoLines.forEach(line => {
        if (line.trim()) {
          const [mnemonic, value] = line.split(':').map(part => part.trim());
          if (mnemonic && value) {
            wellInfo[mnemonic] = value;
          }
        }
      });
    }
    
    // Parse curve information
    const curveInfoSection = sections.find(section => section.startsWith('C'));
    const curveInfo: Array<{name: string, unit: string, description: string}> = [];
    if (curveInfoSection) {
      const curveInfoLines = curveInfoSection.split('\n').slice(1);
      curveInfoLines.forEach(line => {
        if (line.trim()) {
          const parts = line.split('.').map(part => part.trim());
          if (parts.length >= 3) {
            const name = parts[0];
            const unit = parts[1];
            const description = parts[2];
            if (name && !name.includes('MNEM') && !name.includes('UNIT')) {
              curveInfo.push({ name, unit, description });
            }
          }
        }
      });
    }
    
    // Parse log data
    const logDataSection = sections.find(section => section.startsWith('A'));
    const logData: Record<string, number[]> = {};
    const depthValues: number[] = [];
    
    if (logDataSection) {
      const logDataLines = logDataSection.split('\n').slice(1);
      const curveNames = curveInfo.map(curve => curve.name);
      
      // Initialize curve arrays
      curveNames.forEach(curve => {
        logData[curve] = [];
      });
      
      logDataLines.forEach(line => {
        if (line.trim()) {
          const values = line.split(/\s+/).map(val => parseFloat(val));
          if (values.length > 0) {
            depthValues.push(values[0]);
            
            // Map values to curves
            curveNames.forEach((curve, index) => {
              if (values[index + 1] !== undefined) {
                logData[curve].push(values[index + 1]);
              }
            });
          }
        }
      });
    }
    
    return {
      versionInfo,
      wellInfo,
      curveInfo,
      logData,
      depthValues
    };
  } catch (error) {
    console.error('Error parsing LAS file:', error);
    throw error;
  }
};

/**
 * Gets a list of available LAS files in the sample data directory
 * @returns Promise with an array of file paths
 */
export const getAvailableLasFiles = async (): Promise<string[]> => {
  try {
    // In a real application, this would fetch from an API or file system
    // For this demo, we'll return the hardcoded paths to our sample files
    return [
      '/sampleData/petrophysics-agent/structured-data-files/Wilson_1H.las',
      '/sampleData/petrophysics-agent/structured-data-files/Wilson_2H.las',
      '/sampleData/petrophysics-agent/structured-data-files/Wilson_3H.las',
      '/sampleData/petrophysics-agent/structured-data-files/Wilson_4H.las'
    ];
  } catch (error) {
    console.error('Error getting available LAS files:', error);
    throw error;
  }
}; 