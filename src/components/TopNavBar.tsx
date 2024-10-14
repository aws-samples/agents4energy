"use client"
import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  Tooltip,
  Typography,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Link
} from '@mui/material';
// import MenuIcon from '@mui/icons-material/Menu';
// import DropdownMenu from '@/components/DropDownMenu';

import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchUserAttributes, FetchUserAttributesOutput } from 'aws-amplify/auth';

const getUserAttributes = async () => {
  try {
    const userAttributes = (await fetchUserAttributes());
    return userAttributes;
  } catch {
    return null;
  }
};


const TopNavBar = () => {
  const [userAttributes, setUserAttributes] = useState<FetchUserAttributesOutput | null>();
  const { user, signOut, authStatus } = useAuthenticator(context => [context.user, context.authStatus]);
  // const [anchorElNav, setAnchorElNav] = React.useState<null | HTMLElement>(null);
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);

  //TODO Impliment the dropdown menu for the user menu
  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  // const handleCloseNavMenu = () => {
  //   setAnchorElNav(null);
  // };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  // Set the user attributtes if the user is signed in
  useEffect(() => {
    if (user) {
      getUserAttributes().then(
        (attriutes) => {
          setUserAttributes(attriutes)
        }
      );
    }
  }, [user])

  return (
    <AppBar
      position="fixed"
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
    >
      <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Link color="inherit" href='/' sx={{ textDecoration: 'none' }}>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              AWS Agents For Energy
            </Typography>
          </Link>
        </Box>


        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Link color="inherit" href='/chat' sx={{ textDecoration: 'none' }}>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Chat
            </Typography>
          </Link>

          {authStatus === 'authenticated' && userAttributes?.email ? (

            <Box sx={{ flexGrow: 0 }}>
              <Tooltip title="Open settings">
                <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
                  <Typography sx={{ textAlign: 'center' }}>{userAttributes.email}</Typography>
                </IconButton>
              </Tooltip>
              <Menu
                sx={{ mt: '45px' }}
                id="menu-appbar"
                anchorEl={anchorElUser}
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                keepMounted
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                open={Boolean(anchorElUser)}
                onClose={handleCloseUserMenu}
              >
                <MenuItem key='logout' onClick={signOut}>
                  <Typography sx={{ textAlign: 'center' }}>logout</Typography>
                </MenuItem>

              </Menu>
            </Box>
          ) : <Link color="inherit" href='/login' sx={{ textDecoration: 'none' }}>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Login
            </Typography>
          </Link>
          }
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default TopNavBar;
