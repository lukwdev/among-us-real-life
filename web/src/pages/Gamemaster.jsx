import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Paper, Stack, TextField, Typography } from '@mui/material';

function formatTime(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Gamemaster() {
    const [authorized, setAuthorized] = useState(false);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [connected, setConnected] = useState(false);
    const [snapshot, setSnapshot] = useState({ players: [], log: [] });
    const socketRef = useRef(null);
    const sessionRef = useRef('');

    useEffect(() => {
        let saved = '';
        try {
            saved = localStorage.getItem('adminSession') || '';
        } catch {
            saved = '';
        }
        sessionRef.current = saved;
        const socket = io({ query: { role: 'ADMIN' }, reconnection: true });
        socketRef.current = socket;
        socket.on('connect', () => {
            setConnected(true);
            socket.timeout(10000).emit('admin-login', saved ? { sessionToken: saved } : { code: '' }, (timeoutError, response) => {
                if (timeoutError || !response?.ok) {
                    if (saved) {
                        try { localStorage.removeItem('adminSession'); } catch { /* storage is optional */ }
                    }
                    setError(saved ? 'The admin session has expired. Please enter the admin code.' : 'Admin code required.');
                    return;
                }
                sessionRef.current = response.sessionToken || saved;
                if (response.sessionToken) {
                    try { localStorage.setItem('adminSession', response.sessionToken); } catch { /* storage is optional */ }
                }
                setAuthorized(true);
                setError('');
                socket.emit('get-state');
            });
        });
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', () => setError('Cannot connect to the game server.'));
        socket.on('gamemaster-update', (next) => {
            if (next && Array.isArray(next.players)) setSnapshot(next);
        });
        return () => socket.disconnect();
    }, []);

    function login() {
        const socket = socketRef.current;
        if (!socket?.connected || !code.trim()) {
            setError('Please enter the admin code and wait for connection.');
            return;
        }
        socket.timeout(10000).emit('admin-login', { code: code.trim() }, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                const messages = {
                    'invalid-code': 'The admin code is incorrect.',
                    'rate-limited': `Too many login attempts. Please wait ${response?.retryAfterSec ?? 120} seconds before trying again.`,
                    'admin-not-configured': 'Admin access is not configured on the server.',
                    'persistence-unavailable': 'The server could not save your session.'
                };
                setError(messages[response?.reason] || 'Sign in failed. Check the code and try again.');
                return;
            }
            if (response.sessionToken) {
                sessionRef.current = response.sessionToken;
                try { localStorage.setItem('adminSession', response.sessionToken); } catch { /* storage is optional */ }
            }
            setAuthorized(true);
            setError('');
            socketRef.current?.emit('get-state');
        });
    }

    if (!authorized) {
        return (
            <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
                <Card sx={{ width: '100%', maxWidth: 440 }}>
                    <CardContent>
                        <Stack spacing={2}>
                            <Typography variant="h5">Gamemaster Panel</Typography>
                            <Typography color="text.secondary">
                                Only the gamemaster can see roles, player locations, and the full game activity log.
                            </Typography>
                            {error && <Alert severity="error">{error}</Alert>}
                            <TextField
                                autoFocus
                                label="Admin Code"
                                type="password"
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                                onKeyDown={(event) => event.key === 'Enter' && login()}
                                fullWidth
                            />
                            <Button variant="contained" onClick={login} disabled={!connected}>Open Panel</Button>
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    const rooms = snapshot.players.reduce((groups, player) => {
        const room = player.currentRoom || 'No tasks yet';
        groups[room] = [...(groups[room] || []), player];
        return groups;
    }, {});

    return (
        <Stack spacing={2} sx={{ width: '100%', py: { xs: 1, sm: 3 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box>
                    <Typography variant="h4">Gamemaster Panel</Typography>
                    <Typography color="text.secondary">Live locations based on recently completed tasks</Typography>
                </Box>
                <Chip color={connected ? 'success' : 'warning'} label={connected ? 'Live Connected' : 'Connecting...'} />
            </Stack>
            {!connected && <Alert severity="warning">Connection to the game server is lost.</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.5fr) minmax(320px, 0.8fr)' }, gap: 2, alignItems: 'start' }}>
                <Card>
                    <CardContent>
                        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
                            <Typography variant="h6">Players by Room</Typography>
                            <Typography variant="body2" color="text.secondary">{snapshot.players.length} players</Typography>
                        </Stack>
                        {Object.keys(rooms).length === 0 ? (
                            <Typography color="text.secondary">No players in the game yet.</Typography>
                        ) : (
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
                                {Object.entries(rooms).map(([room, players]) => (
                                    <Paper key={room} variant="outlined" sx={{ p: 1.5 }}>
                                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                                            <Typography fontWeight={700}>{room}</Typography>
                                            <Chip size="small" label={players.length} />
                                        </Stack>
                                        <Stack spacing={0.75}>
                                            {players.map((player) => (
                                                <Stack key={player.id} direction="row" justifyContent="space-between" alignItems="center">
                                                    <Box>
                                                        <Typography variant="body2" fontWeight={600}>{player.name}</Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {player.lastTask || 'No tasks completed'} · {formatTime(player.lastTaskAt)}
                                                        </Typography>
                                                    </Box>
                                                    <Stack direction="row" spacing={0.5}>
                                                        {player.role === 'Impostor' && <Chip size="small" color="error" label="Impostor" />}
                                                        {!player.alive && <Chip size="small" color="default" label="Eliminated" />}
                                                        {!player.connected && <Chip size="small" label="Offline" />}
                                                    </Stack>
                                                </Stack>
                                            ))}
                                        </Stack>
                                    </Paper>
                                ))}
                            </Box>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Game Activity Log</Typography>
                        <Divider sx={{ mb: 1 }} />
                        <Stack spacing={1} sx={{ maxHeight: '65vh', overflowY: 'auto' }}>
                            {snapshot.log.length === 0 ? (
                                <Typography color="text.secondary">No events recorded yet.</Typography>
                            ) : snapshot.log.slice().reverse().map((entry) => (
                                <Box key={entry.id}>
                                    <Typography variant="caption" color="text.secondary">{formatTime(entry.timestamp)}</Typography>
                                    <Typography variant="body2">{entry.message}</Typography>
                                </Box>
                            ))}
                        </Stack>
                    </CardContent>
                </Card>
            </Box>
        </Stack>
    );
}
