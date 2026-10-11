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

function App() {
  return (
    <BrowserRouter>
      <Header />
      <Box sx={{
        py: 3,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 'calc(100vh - 64px)'
      }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Routes>
            <Route path="/" element={<Player />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </Container>
      </Box>
    </BrowserRouter>
  )
}

export default App
