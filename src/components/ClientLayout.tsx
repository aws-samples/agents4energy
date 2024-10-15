'use client'

import React from 'react';
import { Box } from '@mui/material';
import { styled } from '@mui/system';
import TopNavBar from '@/components/TopNavBar';

const PageContainer = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
});

const ContentContainer = styled('div')({
  flexGrow: 1,
  overflow: 'auto',
});

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <TopNavBar />
      <ContentContainer>
        <Box>{children}</Box>
      </ContentContainer>
    </PageContainer>
  );
}