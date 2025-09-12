'use client';

import ContentLayout from "@cloudscape-design/components/content-layout";
import Box from "@cloudscape-design/components/box";
import Grid from "@cloudscape-design/components/grid";
import Container from "@cloudscape-design/components/container";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Pumpjack from '@/pumpjack1.png'; 

export default function Landing() {
  return (
    <ContentLayout
      defaultPadding
      disableOverlap
      headerBackgroundStyle={() =>
      `bottom center/cover url(${Pumpjack.src})`
      }
      header={
        <Box padding={{ vertical: "xxxl" }}>
          <Grid
            gridDefinition={[
              { colspan: { default: 12, s: 7 } }
            ]}
          >
            <Container>
              <Box padding="s">
                <Box
                  fontSize="display-l"
                  fontWeight="bold"
                  variant="h1"
                  padding="n"
                >
                  Agents4Energy
                </Box>
                <Box
                  fontSize="display-l"
                  fontWeight="light"
                >
                  Accelerate your GenAI journey with agentic workflows
                </Box>
                <Box
                  variant="p"
                  color="text-body-secondary"
                  margin={{ top: "xs", bottom: "l" }}
                >
                  Deploy persona-based AI assistants on AWS to automate and optimize your operations.
                </Box>
                <SpaceBetween
                  direction="horizontal"
                  size="xs"
                >
                  <Button variant="primary" href='/chat'>
                    Start a Chat
                  </Button>
                </SpaceBetween>
              </Box>
            </Container>
          </Grid>
        </Box>
      }
    />
  );
}
