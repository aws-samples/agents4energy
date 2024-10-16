'use client'

import React from 'react';
import { Box } from '@mui/material';
import TopNavBar from '@/components/TopNavBar';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Box sx={{ flexGrow: 1 }}>
        <TopNavBar />
      </Box>
      <Box sx={{ mt: 10 }}>{children}</Box>
    </Box>
  );
}