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
                    setError(saved ? 'Die Admin-Sitzung ist abgelaufen. Bitte Code eingeben.' : 'Admin-Code erforderlich.');
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
        socket.on('connect_error', () => setError('Keine Verbindung zum Spielserver.'));
        socket.on('gamemaster-update', (next) => {
            if (next && Array.isArray(next.players)) setSnapshot(next);
        });
        return () => socket.disconnect();
    }, []);

    function login() {
        const socket = socketRef.current;
        if (!socket?.connected || !code.trim()) {
            setError('Bitte Admin-Code eingeben und Verbindung abwarten.');
            return;
        }
        socket.timeout(10000).emit('admin-login', { code: code.trim() }, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                setError(response?.reason === 'invalid-code' ? 'Der Admin-Code ist falsch.' : 'Anmeldung fehlgeschlagen.');
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
                            <Typography variant="h5">Gamemasterpanel</Typography>
                            <Typography color="text.secondary">
                                Nur der Gamemaster sieht Rollen, Räume und das vollständige Spielprotokoll.
                            </Typography>
                            {error && <Alert severity="error">{error}</Alert>}
                            <TextField
                                autoFocus
                                label="Admin-Code"
                                type="password"
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                                onKeyDown={(event) => event.key === 'Enter' && login()}
                                fullWidth
                            />
                            <Button variant="contained" onClick={login} disabled={!connected}>Öffnen</Button>
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    const rooms = snapshot.players.reduce((groups, player) => {
        const room = player.currentRoom || 'Noch kein Task';
        groups[room] = [...(groups[room] || []), player];
        return groups;
    }, {});

    return (
        <Stack spacing={2} sx={{ width: '100%', py: { xs: 1, sm: 3 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box>
                    <Typography variant="h4">Gamemasterpanel</Typography>
                    <Typography color="text.secondary">Live-Positionen aus den zuletzt erledigten Tasks</Typography>
                </Box>
                <Chip color={connected ? 'success' : 'warning'} label={connected ? 'Live verbunden' : 'Verbindung wird hergestellt'} />
            </Stack>
            {!connected && <Alert severity="warning">Die Verbindung zum Spielserver ist unterbrochen.</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.5fr) minmax(320px, 0.8fr)' }, gap: 2, alignItems: 'start' }}>
                <Card>
                    <CardContent>
                        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
                            <Typography variant="h6">Spieler nach Raum</Typography>
                            <Typography variant="body2" color="text.secondary">{snapshot.players.length} Spieler</Typography>
                        </Stack>
                        {Object.keys(rooms).length === 0 ? (
                            <Typography color="text.secondary">Noch keine Spieler im Spiel.</Typography>
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
                                                            {player.lastTask || 'Noch kein Task'} · {formatTime(player.lastTaskAt)}
                                                        </Typography>
                                                    </Box>
                                                    <Stack direction="row" spacing={0.5}>
                                                        {player.role === 'Impostor' && <Chip size="small" color="error" label="Impostor" />}
                                                        {!player.alive && <Chip size="small" label="Tot" />}
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
                        <Typography variant="h6" gutterBottom>Spiel-Log</Typography>
                        <Divider sx={{ mb: 1 }} />
                        <Stack spacing={1} sx={{ maxHeight: '65vh', overflowY: 'auto' }}>
                            {snapshot.log.length === 0 ? (
                                <Typography color="text.secondary">Noch keine Ereignisse.</Typography>
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
