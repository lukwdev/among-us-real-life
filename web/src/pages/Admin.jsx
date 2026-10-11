
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Button, Card, CardContent, Stack, TextField, Typography, List, ListItem, ListItemText, IconButton, Divider, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

export default function Admin() {
    const [authorized, setAuthorized] = useState(false);
    const [adminCode, setAdminCode] = useState('');
    const [authId] = useState(() => {
        // simple per-tab admin id
        let a = sessionStorage.getItem('adminAuth');
        if (!a) { a = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('adminAuth', a); }
        return a;
    });
    const socketRef = useRef(null);
    const [meeting, setMeeting] = useState(false);
    const [gameActive, setGameActive] = useState(false);
    const [numImpostors, setNumImpostors] = useState('1');
    const [numTasksPerPlayer, setNumTasksPerPlayer] = useState('5');
    const [taskName, setTaskName] = useState('');
    const [taskLocation, setTaskLocation] = useState('');
    const [tasks, setTasks] = useState([]);
    const [cooldownMinutes, setCooldownMinutes] = useState('0');
    const [killCooldownSeconds, setKillCooldownSeconds] = useState('0');
    const [maxPlayersPerTask, setMaxPlayersPerTask] = useState('2');
    const [sabotageSeconds, setSabotageSeconds] = useState('20');
    const [sabotageCharges, setSabotageCharges] = useState('2');
    const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
    const [connectedPlayers, setConnectedPlayers] = useState([]);
    const [startError, setStartError] = useState('');

    useEffect(() => {
        if (!authorized) return;
        const socket = io({ query: { role: 'ADMIN' } });
        socketRef.current = socket;

        socket.on('play-meeting', async () => {
            await waitMs(2000);
        });

        socket.on('meeting-started', () => setMeeting(true));
        socket.on('meeting-ended', () => setMeeting(false));
        socket.on('game-started', () => setGameActive(true));
        socket.on('game-ended', () => { setGameActive(false); setMeeting(false); setCooldownRemainingMs(0); });
        socket.on('state', (s) => {
            setMeeting(!!s?.isMeeting);
            setGameActive(!!s?.isGameActive);
            if (typeof s?.emergencyCooldownEndMs === 'number') {
                const remaining = s.emergencyCooldownEndMs - Date.now();
                setCooldownRemainingMs(Math.max(0, remaining));
            }
            if (s?.config) {
                if (typeof s.config.numImpostors === 'number') setNumImpostors(String(s.config.numImpostors));
                if (typeof s.config.numTasksPerPlayer === 'number') setNumTasksPerPlayer(String(s.config.numTasksPerPlayer));
                if (Array.isArray(s.config.tasks)) setTasks(s.config.tasks);
                if (typeof s.config.emergencyCooldownMinutes === 'number') setCooldownMinutes(String(s.config.emergencyCooldownMinutes));
                if (typeof s.config.killCooldownSeconds === 'number') setKillCooldownSeconds(String(s.config.killCooldownSeconds));
                if (typeof s.config.maxPlayersPerTask === 'number') setMaxPlayersPerTask(String(s.config.maxPlayersPerTask));
                if (typeof s.config.sabotageDurationSeconds === 'number') setSabotageSeconds(String(s.config.sabotageDurationSeconds));
                if (typeof s.config.sabotageCharges === 'number') setSabotageCharges(String(s.config.sabotageCharges));
            }
            // Update connected players from state
            if (Array.isArray(s?.players)) {
                setConnectedPlayers(s.players);
            }
        });

        socket.on('cooldown-updated', ({ emergencyCooldownEndMs }) => {
            if (typeof emergencyCooldownEndMs === 'number') {
                const remaining = emergencyCooldownEndMs - Date.now();
                setCooldownRemainingMs(Math.max(0, remaining));
            }
        });

        // Listen for player updates
        socket.on('players-updated', (players) => {
            if (Array.isArray(players)) {
                setConnectedPlayers(players);
            }
        });
        socket.on('start-error', (error) => {
            const reason = error?.reason;
            setStartError(reason === 'no-players'
                ? 'At least one player must be connected before starting.'
                : 'The game could not be started. Check the game status and try again.');
        });

        return () => socket.disconnect();
    }, [authorized]);

    useEffect(() => {
        if (!authorized) return;
        function onKeyDown(e) {
            const target = e.target;
            const tag = target && target.tagName;
            const isEditable = target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA');
            if (isEditable) return;
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                emergencyMeeting();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [authorized]);

    function startGameWithConfig() {
        setStartError('');
        const payload = {
            numImpostors: Number.isFinite(parseInt(numImpostors, 10)) ? parseInt(numImpostors, 10) : 0,
            numTasksPerPlayer: Number.isFinite(parseInt(numTasksPerPlayer, 10)) ? parseInt(numTasksPerPlayer, 10) : undefined,
            tasks: tasks.length ? tasks : undefined,
            emergencyCooldownMinutes: Number.isFinite(parseFloat(cooldownMinutes)) ? parseFloat(cooldownMinutes) : 0,
            killCooldownSeconds: Number.isFinite(parseFloat(killCooldownSeconds)) ? parseFloat(killCooldownSeconds) : 0,
            maxPlayersPerTask: Number.isFinite(parseInt(maxPlayersPerTask, 10)) ? parseInt(maxPlayersPerTask, 10) : undefined,
            sabotageDurationSeconds: Number.isFinite(parseInt(sabotageSeconds, 10)) ? parseInt(sabotageSeconds, 10) : undefined,
            sabotageCharges: Number.isFinite(parseInt(sabotageCharges, 10)) ? parseInt(sabotageCharges, 10) : undefined
        };
        socketRef.current?.emit('start-game', payload);
    }

    function emergencyMeeting() {
        socketRef.current?.emit('emergency-meeting');
    }

    function continueGame() {
        socketRef.current?.emit('continue-game');
    }

    // Cooldown countdown tick
    useEffect(() => {
        const i = setInterval(() => {
            setCooldownRemainingMs((prev) => {
                const next = prev - 1000;
                return next > 0 ? next : 0;
            });
        }, 1000);
        return () => clearInterval(i);
    }, []);

    useEffect(() => {
        if (!meeting && gameActive) {
            // When meeting ends, ask the server for a fresh snapshot (to get cooldown end)
            socketRef.current?.emit('get-state');
        }
    }, [meeting, gameActive]);

    async function waitMs(ms) {
        await new Promise((r) => setTimeout(r, ms));
    }

    // Removed auto-login; require code entry each visit

    if (!authorized) {
        return (
            <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
                <Card sx={{ width: '100%', maxWidth: 420 }}>
                    <CardContent>
                        <Stack spacing={2}>
                            <Typography variant="h6" gutterBottom>Admin Access</Typography>
                            <TextField label="Admin Code" type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    if (adminCode && adminCode === import.meta.env.VITE_ADMIN_CODE) {
                                        setAuthorized(true);
                                    }
                                }
                            }} fullWidth />
                            <Button variant="contained" onClick={() => {
                                if (adminCode && adminCode === import.meta.env.VITE_ADMIN_CODE) {
                                    setAuthorized(true);
                                }
                            }}>Enter</Button>
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    const showStart = !gameActive;
    const showEmergency = gameActive && !meeting;
    const showContinue = meeting;

    return (
        <>
            <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
                <Typography variant="overline">Admin ({authId})</Typography>
                {startError && <Typography color="error" role="alert">{startError}</Typography>}

                {/* Connected Players Table */}
                <Card sx={{ width: '100%', maxWidth: 820 }}>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Players connected ({connectedPlayers.filter((player) => player.connected).length}/{connectedPlayers.length})
                        </Typography>
                        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><strong>Name</strong></TableCell>
                                        <TableCell><strong>Status</strong></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {connectedPlayers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={2} align="center">
                                                <Typography variant="body2" color="text.secondary">No players have logged in yet</Typography>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        connectedPlayers.map((player, idx) => (
                                            <TableRow key={player.id || idx} hover>
                                                <TableCell>{player.name || 'Unknown'}</TableCell>
                                                <TableCell>
                                                    <Typography color={player.connected ? 'success.main' : 'text.secondary'}>
                                                        {player.connected ? 'Connected' : 'Offline'}
                                                        {player.alive === false ? ' · Dead' : ''}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </CardContent>
                </Card>

                <Card sx={{ width: '100%', maxWidth: 420 }}>
                    <CardContent>
                        <Stack spacing={2} alignItems="center">
                            {showStart && (
                                <>
                                    <TextField label="Number of Impostors" value={numImpostors} onChange={(e) => setNumImpostors(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Tasks per Player" value={numTasksPerPlayer} onChange={(e) => setNumTasksPerPlayer(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Emergency Cooldown (minutes)" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="decimal" fullWidth />
                                    <TextField label="Kill Cooldown (seconds)" value={killCooldownSeconds} onChange={(e) => setKillCooldownSeconds(e.target.value)} inputMode="decimal" fullWidth />
                                    <TextField label="Sabotage Duration (seconds)" value={sabotageSeconds} onChange={(e) => setSabotageSeconds(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Sabotage Charges (shared)" value={sabotageCharges} onChange={(e) => setSabotageCharges(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Max Players per Task" value={maxPlayersPerTask} onChange={(e) => setMaxPlayersPerTask(e.target.value)} inputMode="numeric" fullWidth />
                                    <Stack direction="row" spacing={1}>
                                        <TextField label="Task" value={taskName} onChange={(e) => setTaskName(e.target.value)} fullWidth />
                                        <TextField label="Location" value={taskLocation} onChange={(e) => setTaskLocation(e.target.value)} fullWidth />
                                        <Button variant="contained" onClick={() => {
                                            const name = taskName.trim();
                                            const loc = taskLocation.trim();
                                            if (!name) return;
                                            const label = loc ? `${name} (${loc})` : name;
                                            setTasks((t) => [...t, label]);
                                            setTaskName('');
                                            setTaskLocation('');
                                        }}>Add</Button>
                                    </Stack>
                                    <Paper variant="outlined" sx={{ width: '100%', maxHeight: 240, overflowY: 'auto' }}>
                                        <List dense disablePadding>
                                            {tasks.map((t, idx) => (
                                                <>
                                                    <ListItem key={idx}
                                                              secondaryAction={
                                                                  <IconButton edge="end" aria-label="delete" onClick={() => setTasks(tasks.filter((_, i) => i !== idx))}>
                                                                      <DeleteIcon />
                                                                  </IconButton>
                                                              }
                                                    >
                                                        <ListItemText primary={t} />
                                                    </ListItem>
                                                    {idx < tasks.length - 1 && <Divider component="li" />}
                                                </>
                                            ))}
                                            {tasks.length === 0 && (
                                                <ListItem>
                                                    <ListItemText primary="No tasks yet. Add some above." />
                                                </ListItem>
                                            )}
                                        </List>
                                    </Paper>
                                    <Button variant="contained" color="primary" id="start-game" onClick={() => startGameWithConfig()}>Start Game</Button>
                                </>
                            )}
                            {showEmergency && (
                                <Button variant="outlined" color="error" onClick={emergencyMeeting} disabled={cooldownRemainingMs > 0}>
                                    {cooldownRemainingMs > 0 ? `Emergency Cooldown (${Math.ceil(cooldownRemainingMs / 1000)}s)` : 'Emergency Meeting (Space)'}
                                </Button>
                            )}
                            {showContinue && (
                                <>
                                    <Typography variant="h5" color="error">MEETING TIME</Typography>
                                    <Button variant="contained" onClick={continueGame}>Continue</Button>
                                </>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </>
    );
}