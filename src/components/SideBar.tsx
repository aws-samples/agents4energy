"use client"
import React, { useState, ReactNode } from 'react';
import {
    Box,
    Drawer,
    // AppBar,
    Toolbar,
    // Typography,
    IconButton,
    // List,
    // ListItem,
    // ListItemIcon,
    // ListItemText,
    styled,
} from '@mui/material';
import {
    Menu as MenuIcon,
    // Mail as MailIcon,
    // Settings as SettingsIcon,
    // Person as PersonIcon,
    ChevronLeft as ChevronLeftIcon,
} from '@mui/icons-material';

const drawerWidth = 240;

interface SideBarProps {
    drawerContent: ReactNode;
    children: ReactNode;
    anchor: "right" | "left";
    initiallyOpen?: boolean;
    floatingButton?: boolean;
}

// const Main = styled('main', { shouldForwardProp: (prop) => prop !== 'open' })<{
//     open?: boolean;
// }>(({ theme, open }) => ({
//     flexGrow: 1,
//     padding: theme.spacing(3),
//     transition: theme.transitions.create('margin', {
//         easing: theme.transitions.easing.sharp,
//         duration: theme.transitions.duration.leavingScreen,
//     }),
//     marginRight: -drawerWidth,
//     ...(open && {
//         transition: theme.transitions.create('margin', {
//             easing: theme.transitions.easing.easeOut,
//             duration: theme.transitions.duration.enteringScreen,
//         }),
//         marginRight: 0,
//     }),
// }));

const Main = styled('main', { 
    shouldForwardProp: (prop) => !['open', 'anchor'].includes(prop as string) 
})<{
    open?: boolean;
    anchor?: 'left' | 'right';
}>(({ theme, open, anchor }) => ({
    flexGrow: 1,
    padding: theme.spacing(3),
    transition: theme.transitions.create('margin', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
    }),
    ...(anchor === 'left' ? {
        // marginLeft: -drawerWidth,
        marginLeft: 0,
        ...(open && {
            transition: theme.transitions.create('margin', {
                easing: theme.transitions.easing.easeOut,
                duration: theme.transitions.duration.enteringScreen,
            }),
            // marginLeft: 0,
            marginLeft: drawerWidth,
        }),
    } : {
        marginRight: -drawerWidth*2,
        ...(open && {
            transition: theme.transitions.create('margin', {
                easing: theme.transitions.easing.easeOut,
                duration: theme.transitions.duration.enteringScreen,
            }),
            marginRight: -drawerWidth,
        }),
    }),
}));

const DrawerHeader = styled('div')(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0, 1),
    ...theme.mixins.toolbar,
    justifyContent: 'flex-end', // Changed to align the icon to the right
}));

// New component for the floating hamburger button
export const FloatingHamburger = styled(IconButton, {
    shouldForwardProp: (prop) => prop !== 'anchor',
  })<{
    anchor: "left" | "right";
  }>(({ theme, anchor }) => ({
    position: 'fixed',
    ...(anchor === 'left' ? { left: theme.spacing(2) } : { right: theme.spacing(2) }),
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    '&:hover': {
      backgroundColor: theme.palette.primary.dark,
    },
    zIndex: theme.zIndex.drawer - 1,
    boxShadow: '0 3px 5px 2px rgba(0, 0, 0, .3)',
    borderRadius: '50%',
    padding: theme.spacing(1),
  }));

const AddSideBar: React.FC<SideBarProps> = ({ children, anchor, drawerContent, initiallyOpen = true, floatingButton = true }: SideBarProps) => {
    const [open, setOpen] = useState(initiallyOpen);

    const handleDrawerOpen = () => {
        setOpen(true);
    };

    const handleDrawerClose = () => {
        setOpen(false);
    };

    return (
        <Box sx={{ display: 'flex' }}>
            
            <Main 
            open={open}
            anchor={anchor}
            >
                <DrawerHeader />
                {children}
            </Main>

            {!open && floatingButton && (
                <FloatingHamburger
                    color="inherit"
                    aria-label="open drawer"
                    edge="start"
                    onClick={handleDrawerOpen}
                    size="large"
                    anchor={anchor}
                >
                    <MenuIcon />
                </FloatingHamburger>
            )}

            <Drawer
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: drawerWidth,
                    },
                }}
                variant="persistent"
                anchor={anchor}
                open={open}
            >
                <Toolbar />
                <DrawerHeader>
                    <IconButton onClick={handleDrawerClose}>
                        <ChevronLeftIcon /> {/* Changed to chevron icon */}
                    </IconButton>
                </DrawerHeader>
                {drawerContent}
            </Drawer>
        </Box>
    )

}

export default AddSideBar;