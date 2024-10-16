'use client'

import React from 'react';
import { Box } from '@mui/material';
import TopNavBar from '@/components/TopNavBar';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box height="100vh">
      <Box>
        <TopNavBar />
      </Box>
      <Box sx={{ mt: 8 }}>{children}</Box>
    </Box>
  );
}