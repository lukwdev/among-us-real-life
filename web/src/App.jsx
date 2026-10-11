import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Player from './pages/Player.jsx'
import Admin from './pages/Admin.jsx'
import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material'

function Header() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <AppBar position="static" color="primary">
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h6">{isAdmin ? 'Admin' : 'Player'}</Typography>
      </Toolbar>
    </AppBar>
  );
}

function AppContent() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <>
      <Header />
      <Box sx={{
        py: { xs: 1, sm: 3 },
        display: 'flex',
        justifyContent: 'center',
        alignItems: isAdmin ? 'flex-start' : 'center',
        minHeight: 'calc(100vh - 64px)'
      }}>
        <Container
          maxWidth={isAdmin ? false : 'sm'}
          sx={{
            width: '100%',
            px: { xs: 1, sm: 2 },
            textAlign: isAdmin ? 'left' : 'center'
          }}
        >
          <Routes>
            <Route path="/" element={<Player />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </Container>
      </Box>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App
