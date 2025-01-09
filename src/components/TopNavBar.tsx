"use client"
import React, { useState, useEffect }from 'react';
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

import { useAuthenticator } from '@aws-amplify/ui-react';

import { fetchUserAttributes, FetchUserAttributesOutput } from 'aws-amplify/auth';

// import { useUserAttributes } from '@/components/UserAttributesProvider';

const TopNavBar = () => {
  const { signOut, authStatus } = useAuthenticator(context => [context.user, context.authStatus]);
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);

    const [userAttributes, setUserAttributes] = useState<FetchUserAttributesOutput | null>(null);
  
    // const { authStatus } = useAuthenticator(context => [context.authStatus]);
  
    //If the user starts out unauthenticated, make sure the userAttributes are null
    useEffect(() => {
      if (authStatus === 'unauthenticated') {
        setUserAttributes(null)
      } else if (authStatus === 'authenticated') {
        const fetchAttributes = async () => {
          const userAttributesResponse = await fetchUserAttributes();
          if (userAttributesResponse) setUserAttributes(userAttributesResponse);
        }
        fetchAttributes();
      }
    }, [authStatus]);


  // const { userAttributes } = useUserAttributes();

  //TODO Impliment the dropdown menu for the user menu
  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  return (
    <>
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Link color="inherit" href='/' sx={{ textDecoration: 'none' }}>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                Agents4Energy
              </Typography>
            </Link>

            <Link color="inherit" href='/files' sx={{ textDecoration: 'none' }}>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                Files
              </Typography>
            </Link>

            <Link color="inherit" href='/chat' sx={{ textDecoration: 'none' }}>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                Chat
              </Typography>
            </Link>

          </Box>


          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>

            {userAttributes?.email ? (

              <Box sx={{ flexGrow: 0 }}>
                <Tooltip title="Open settings">
                  <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }} color="inherit">
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
            ) :
              (authStatus === "unauthenticated") ? (
                <Link color="inherit" href='/login' sx={{ textDecoration: 'none' }}>
                  <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                    Login
                  </Typography>
                </Link>
              ) : null 
              //<button onClick={signOut}>{authStatus} {JSON.stringify(userAttributes)}</button>
            }
          </Box>
        </Toolbar>
      </AppBar>
      {/* <Toolbar /> */}
    </>
  );
};

export default TopNavBar;
