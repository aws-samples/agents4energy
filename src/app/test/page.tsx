"use client"

import AddSideBar from '@/components/SideBar';
// import { RightDrawer } from '@/components/SideBar';

// export default () => <RightDrawer/>

import React, { useState } from 'react';
import {
    Box,
    Drawer,
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    styled,
} from '@mui/material';
import {
    Menu as MenuIcon,
    Mail as MailIcon,
    Settings as SettingsIcon,
    Person as PersonIcon,
    ChevronLeft as ChevronLeftIcon,
} from '@mui/icons-material';

const drawerWidth = 240;

const Main = styled('main', { shouldForwardProp: (prop) => prop !== 'open' })<{
    open?: boolean;
}>(({ theme, open }) => ({
    flexGrow: 1,
    padding: theme.spacing(3),
    transition: theme.transitions.create('margin', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
    }),
    marginRight: -drawerWidth,
    ...(open && {
        transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
        marginRight: 0,
    }),
}));

// const AppBarStyled = styled(AppBar, {
//     shouldForwardProp: (prop) => prop !== 'open',
// })<{
//     open?: boolean;
// }>(({ theme, open }) => ({
//     transition: theme.transitions.create(['margin', 'width'], {
//         easing: theme.transitions.easing.sharp,
//         duration: theme.transitions.duration.leavingScreen,
//     }),
//     ...(open && {
//         width: `calc(100% - ${drawerWidth}px)`,
//         transition: theme.transitions.create(['margin', 'width'], {
//             easing: theme.transitions.easing.easeOut,
//             duration: theme.transitions.duration.enteringScreen,
//         }),
//     }),
// }));

const DrawerHeader = styled('div')(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0, 1),
    ...theme.mixins.toolbar,
    justifyContent: 'flex-end', // Changed to align the icon to the right
}));

// New component for the floating hamburger button
const FloatingHamburger = styled(IconButton)(({ theme }) => ({
    position: 'fixed',
    right: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    '&:hover': {
        backgroundColor: theme.palette.primary.dark,
    },
    zIndex: theme.zIndex.drawer - 1,
}));

const RightDrawer2: React.FC = () => {
    const [open, setOpen] = useState(false);

    const handleDrawerOpen = () => {
        setOpen(true);
    };

    const handleDrawerClose = () => {
        setOpen(false);
    };

    return (
        <Box sx={{ display: 'flex' }}>
            <AddSideBar
                anchor="left"
                drawerContent={<p>Hello World</p>}
                >
                <Typography paragraph>
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam ipsum purus,
                    bibendum sit amet vulputate eget, porta semper ligula. Donec bibendum
                    vulputate erat, ac fringilla mi finibus nec. Donec ac dolor sed dolor
                    porttitor blandit vel vel purus.
                </Typography>

                <Typography paragraph>
                    Fusce vel malesuada ligula. Nam quis vehicula ante, eu finibus est. Proin
                    ullamcorper fermentum orci, quis finibus massa. Nunc lobortis, massa ut
                    rutrum ultrices, metus metus finibus ex, sit amet facilisis neque enim
                    sed dolor.
                </Typography>
            </AddSideBar>
        </Box>
    );
};

export default RightDrawer2;