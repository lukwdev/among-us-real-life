import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AppBar, Box, CircularProgress, Container, Toolbar, Typography } from '@mui/material'
import Player from './pages/Player.jsx'

const Admin = lazy(() => import('./pages/Admin.jsx'))
const Gamemaster = lazy(() => import('./pages/Gamemaster.jsx'))

function Header() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const isGamemaster = location.pathname.startsWith('/gamemaster');

  return (
    <AppBar position="static" color="primary">
      <Toolbar sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            component="img"
            src="/app-icon.svg"
            alt="Among Us Logo"
            sx={{ width: 34, height: 34, borderRadius: 1 }}
          />
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '0.03em' }}>
            {isGamemaster ? 'Gamemaster' : isAdmin ? 'Admin' : 'Among Us IRL'}
          </Typography>
        </Box>
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
          <Suspense fallback={
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
              <CircularProgress color="primary" />
            </Box>
          }>
            <Routes>
              <Route path="/" element={<Player />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/gamemaster" element={<Gamemaster />} />
            </Routes>
          </Suspense>
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
