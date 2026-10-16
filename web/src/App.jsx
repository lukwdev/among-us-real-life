import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Player from './pages/Player.jsx'
import Admin from './pages/Admin.jsx'
import Gamemaster from './pages/Gamemaster.jsx'
import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material'

function Header() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const isGamemaster = location.pathname.startsWith('/gamemaster');

  return (
    <AppBar position="static" color="primary">
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h6">{isGamemaster ? 'Gamemaster' : isAdmin ? 'Admin' : 'Player'}</Typography>
      </Toolbar>
    </AppBar>
  );
}

function AppContent() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin') || location.pathname.startsWith('/gamemaster');

  return (
    <>
      {isAdmin && <Header />}
      <Box sx={{
        py: isAdmin ? { xs: 1, sm: 3 } : { xs: 0.5, sm: 2 },
        display: 'flex',
        justifyContent: 'center',
        alignItems: isAdmin ? 'flex-start' : 'center',
        minHeight: isAdmin ? 'calc(100vh - 64px)' : '100vh'
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
            <Route path="/gamemaster" element={<Gamemaster />} />
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
