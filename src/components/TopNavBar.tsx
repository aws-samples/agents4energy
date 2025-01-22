"use client"
import React from 'react';
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
import TopNavigation from "@cloudscape-design/components/top-navigation";

import { useAuthenticator } from '@aws-amplify/ui-react';

import { useUserAttributes } from '@/components/UserAttributesProvider';
import logoSmallTopNavigation from '@/a4e-logo.png'; 

const TopNavBar = () => {
  const { signOut, authStatus } = useAuthenticator(context => [context.user, context.authStatus]);
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);

  const { userAttributes } = useUserAttributes();

  //TODO Impliment the dropdown menu for the user menu
  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  return (
    <>
    <TopNavigation
      identity={{
        href: "/",
        title: "Agents4Energy",
        logo: {
          src: logoSmallTopNavigation.src,
          alt: "A4E"
        }
      }}
      utilities={[
        {
          type: "menu-dropdown",
          text: userAttributes?.email || "Customer Name",
          description: userAttributes?.email || "email@example.com",
          iconName: "user-profile",
          items: [
            { id: "profile", text: "Profile" },
            { id: "preferences", text: "Preferences" },
            { id: "security", text: "Security" },
            {
              id: "support-group",
              text: "Support",
              items: [
                {
                  id: "documentation",
                  text: "Documentation",
                  href: "#",
                  external: true,
                  externalIconAriaLabel:
                    " (opens in new tab)"
                },
                { id: "support", text: "Support" },
                {
                  id: "feedback",
                  text: "Feedback",
                  href: "#",
                  external: true,
                  externalIconAriaLabel:
                    " (opens in new tab)"
                }
              ]
            },
            { id: "signout", text: "Sign out", onChange: signOut }
          ]
        }
      ]}
    />
    </>
  );
};

export default TopNavBar;
