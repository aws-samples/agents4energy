import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

export default function Home() {
  return (
    <Box className="gradient-bg flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="max-w-2xl w-full hover-effect">
        <CardContent>
          <Typography variant="h4" component="h1" gutterBottom>
            Agents4Energy
          </Typography>
          <Typography variant="body1">
            Use AI Assistants to improve operations
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}