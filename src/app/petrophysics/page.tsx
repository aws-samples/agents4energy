'use client';

import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Paper, Select, MenuItem, FormControl, InputLabel, CircularProgress, Alert, SelectChangeEvent } from '@mui/material';
import WellLogViewer from '@/components/WellLogViewer';
import { fetchLasFile, getAvailableLasFiles } from '@/utils/lasFileUtils';

export default function PetrophysicsPage() {
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [lasData, setLasData] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAvailableFiles = async () => {
      try {
        const files = await getAvailableLasFiles();
        setAvailableFiles(files);
        if (files.length > 0) {
          setSelectedFile(files[0]);
        }
      } catch (err) {
        setError('Failed to load available LAS files');
        console.error(err);
      }
    };

    loadAvailableFiles();
  }, []);

  useEffect(() => {
    const loadLasFile = async () => {
      if (!selectedFile) return;

      setLoading(true);
      setError(null);

      try {
        const data = await fetchLasFile(selectedFile);
        setLasData(data);
      } catch (err) {
        setError('Failed to load LAS file');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadLasFile();
  }, [selectedFile]);

  const handleFileChange = (event: SelectChangeEvent<string>) => {
    setSelectedFile(event.target.value);
  };

  const getWellName = (filePath: string): string => {
    return filePath.split('/').pop()?.split('.')[0] || 'Unknown Well';
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Well Log Viewer
        </Typography>

        <Paper sx={{ p: 2, mb: 2 }}>
          <FormControl fullWidth>
            <InputLabel id="well-select-label">Select Well</InputLabel>
            <Select
              labelId="well-select-label"
              value={selectedFile}
              label="Select Well"
              onChange={handleFileChange}
            >
              {availableFiles.map((file) => (
                <MenuItem key={file} value={file}>
                  {file.split('/').pop()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper sx={{ p: 2 }}>
            <WellLogViewer 
              lasData={lasData} 
              wellName={getWellName(selectedFile)}
            />
          </Paper>
        )}
      </Box>
    </Container>
  );
} 