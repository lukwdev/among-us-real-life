
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Alert, Box, Button, Card, CardContent, Chip, Divider, FormControl, IconButton, InputLabel, LinearProgress, List, ListItem, ListItemText, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

export default function Admin() {
    const [authorized, setAuthorized] = useState(false);
    const [adminCode, setAdminCode] = useState('');
    const adminCodeRef = useRef(adminCode);
    adminCodeRef.current = adminCode;
    const authorizedRef = useRef(authorized);
    authorizedRef.current = authorized;
    const adminSessionTokenRef = useRef('');
    const forceCodeLoginRef = useRef(false);
    const [loginAttempt, setLoginAttempt] = useState(() => {
        try {
            return localStorage.getItem('adminSession') ? 1 : 0;
        } catch {
            return 0;
        }
    });
    const [loginError, setLoginError] = useState('');
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [sessionExpiresAt, setSessionExpiresAt] = useState(0);
    const [sessionWarning, setSessionWarning] = useState('');
    const socketRef = useRef(null);
    const [meeting, setMeeting] = useState(false);
    const [gameActive, setGameActive] = useState(false);
    const [numImpostors, setNumImpostors] = useState('1');
    const [numTasksPerPlayer, setNumTasksPerPlayer] = useState('5');
    const [taskName, setTaskName] = useState('');
    const [taskLocation, setTaskLocation] = useState('');
    const [tasks, setTasks] = useState([]);
    const [taskCollections, setTaskCollections] = useState([]);
    const [selectedTaskCollectionId, setSelectedTaskCollectionId] = useState('');
    const [collectionName, setCollectionName] = useState('');
    const [collectionError, setCollectionError] = useState('');
    const [cooldownMinutes, setCooldownMinutes] = useState('0');
    const [killCooldownSeconds, setKillCooldownSeconds] = useState('0');
    const [maxPlayersPerTask, setMaxPlayersPerTask] = useState('2');
    const [sabotageSeconds, setSabotageSeconds] = useState('20');
    const [sabotageCharges, setSabotageCharges] = useState('2');
    const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
    const [connectedPlayers, setConnectedPlayers] = useState([]);
    const [startError, setStartError] = useState('');
    const [playerManagementMessage, setPlayerManagementMessage] = useState('');
    const [globalProgress, setGlobalProgress] = useState({ completed: 0, total: 0, ratio: 0 });
    const [mapUploadInProgress, setMapUploadInProgress] = useState(false);

    useEffect(() => {
        if (!loginAttempt) return;
        const socket = io({ query: { role: 'ADMIN' }, reconnection: true });
        socketRef.current = socket;

        socket.on('connect', () => {
            setIsConnected(true);
            setIsAuthenticating(true);
            let sessionToken = '';
            if (!forceCodeLoginRef.current) {
                try {
                    sessionToken = adminSessionTokenRef.current || localStorage.getItem('adminSession') || '';
                } catch (error) {
                    console.warn('Could not read the saved admin session.', error);
                    sessionToken = adminSessionTokenRef.current;
                }
            }
            const credentials = sessionToken
                ? { sessionToken }
                : { code: adminCodeRef.current };
            if (sessionToken) adminSessionTokenRef.current = sessionToken;
            socket.timeout(10000).emit('admin-login', credentials, (timeoutError, response) => {
                setIsAuthenticating(false);
                if (timeoutError) {
                    setLoginError('The server did not respond in time. Check the connection and retry.');
                    setAuthorized(false);
                    socket.disconnect();
                    return;
                }
                if (!response?.ok) {
                    if (sessionToken && response?.reason === 'invalid-session') {
                        adminSessionTokenRef.current = '';
                        try {
                            localStorage.removeItem('adminSession');
                        } catch (error) {
                            console.warn('Could not clear the expired admin session.', error);
                        }
                        forceCodeLoginRef.current = true;
                    }
                    const messages = {
                        'admin-not-configured': 'The server administrator has not configured ADMIN_CODE.',
                        'invalid-session': 'Your saved admin session expired. Enter the admin code to sign in again.',
                        'invalid-code': 'The admin code is incorrect.',
                        'persistence-unavailable': 'The server could not save your admin session.'
                    };
                    setLoginError(messages[response?.reason] || 'The server could not verify the admin session.');
                    setAuthorized(false);
                    socket.disconnect();
                    return;
                }
                forceCodeLoginRef.current = false;
                setLoginError('');
                setSessionWarning('');
                setAuthorized(true);
                setSessionExpiresAt(response.sessionExpiresAt || 0);
                if (response.sessionToken) {
                    adminSessionTokenRef.current = response.sessionToken;
                    try {
                        localStorage.setItem('adminSession', response.sessionToken);
                    } catch (error) {
                        console.warn('Could not persist the admin session in browser storage.', error);
                        setSessionWarning('This browser could not remember the admin session. You may need to sign in again after refreshing.');
                    }
                    setAdminCode('');
                }
                socket.emit('get-state');
            });
        });
        socket.on('disconnect', () => setIsConnected(false));
        socket.on('connect_error', () => {
            setIsConnected(false);
            setIsAuthenticating(false);
            if (!authorizedRef.current) setLoginError('Could not connect to the server. Check the connection and try again.');
        });

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
                if (typeof s.config.emergencyCooldownMinutes === 'number') setCooldownMinutes(String(s.config.emergencyCooldownMinutes));
                if (typeof s.config.killCooldownSeconds === 'number') setKillCooldownSeconds(String(s.config.killCooldownSeconds));
                if (typeof s.config.maxPlayersPerTask === 'number') setMaxPlayersPerTask(String(s.config.maxPlayersPerTask));
                if (typeof s.config.sabotageDurationSeconds === 'number') setSabotageSeconds(String(s.config.sabotageDurationSeconds));
                if (typeof s.config.sabotageCharges === 'number') setSabotageCharges(String(s.config.sabotageCharges));
            }
            if (Array.isArray(s?.taskCollections)) {
                setTaskCollections(s.taskCollections);
                const selectedId = s.selectedTaskCollectionId || s.taskCollections[0]?.id || '';
                setSelectedTaskCollectionId(selectedId);
                const selected = s.taskCollections.find((collection) => collection.id === selectedId);
                setTasks(selected?.tasks || s.config?.tasks || []);
            } else if (Array.isArray(s?.config?.tasks)) {
                setTasks(s.config.tasks);
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
        socket.on('global-progress', (progress) => {
            if (Number.isFinite(progress?.completed) &&
                Number.isFinite(progress?.total) &&
                Number.isFinite(progress?.ratio)) {
                setGlobalProgress(progress);
            }
        });
        socket.on('start-error', (error) => {
            const reason = error?.reason;
            const messages = {
                'no-players': 'At least one player must be connected before starting.',
                'empty-task-collection': 'Add at least one task to this collection before starting.',
                'invalid-task-collection': 'Select a valid task collection before starting.'
            };
            setStartError(messages[reason] || 'The game could not be started. Check the game status and try again.');
        });

        return () => socket.disconnect();
    }, [loginAttempt]);

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
            taskCollectionId: selectedTaskCollectionId,
            emergencyCooldownMinutes: Number.isFinite(parseFloat(cooldownMinutes)) ? parseFloat(cooldownMinutes) : 0,
            killCooldownSeconds: Number.isFinite(parseFloat(killCooldownSeconds)) ? parseFloat(killCooldownSeconds) : 0,
            maxPlayersPerTask: Number.isFinite(parseInt(maxPlayersPerTask, 10)) ? parseInt(maxPlayersPerTask, 10) : undefined,
            sabotageDurationSeconds: Number.isFinite(parseInt(sabotageSeconds, 10)) ? parseInt(sabotageSeconds, 10) : undefined,
            sabotageCharges: Number.isFinite(parseInt(sabotageCharges, 10)) ? parseInt(sabotageCharges, 10) : undefined
        };
        saveTaskCollections((saved) => {
            if (!saved) return;
            socketRef.current?.emit('start-game', payload);
        });
    }

    function saveTaskCollections(onSaved) {
        setCollectionError('');
        if (!socketRef.current?.connected) {
            setCollectionError('The game server is offline. Reconnect before saving collections.');
            onSaved?.(false);
            return;
        }

        socketRef.current?.timeout(10000).emit('save-task-collections', {
            collections: taskCollections,
            selectedTaskCollectionId
        }, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                const messages = {
                    'game-active': 'Collections cannot be changed while a game is in progress.',
                    'invalid-collections': 'Check collection names and tasks. Names must be unique and tasks cannot be empty.',
                    'persistence-unavailable': 'The server could not save the task collections.'
                };
                setCollectionError(messages[response?.reason] || 'Could not save task collections. Check the connection and try again.');
                onSaved?.(false);
                return;
            }
            setTaskCollections(response.collections);
            setSelectedTaskCollectionId(response.selectedTaskCollectionId);
            onSaved?.(true);
        });
    }

    function uploadCollectionMap(file) {
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            setCollectionError('Choose a JPG, PNG, or WebP image smaller than 10 MB.');
            return;
        }
        const selected = taskCollections.find((collection) => collection.id === selectedTaskCollectionId);
        if (!selected) {
            setCollectionError('Select a collection before uploading its map.');
            return;
        }
        setMapUploadInProgress(true);
        saveTaskCollections((saved) => {
            if (!saved) {
                setMapUploadInProgress(false);
                return;
            }
            const token = adminSessionTokenRef.current || (() => {
                try {
                    return localStorage.getItem('adminSession') || '';
                } catch (error) {
                    console.warn('Could not read the saved admin session for map upload.', error);
                    return '';
                }
            })();
            if (!token) {
                setMapUploadInProgress(false);
                setCollectionError('Your admin session is not available. Sign in again before uploading a map.');
                return;
            }
            fetch(`/api/admin/collections/${encodeURIComponent(selected.id)}/map`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': file.type
                },
                body: file
            }).then(async (response) => {
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.ok) {
                    const messages = {
                        unauthorized: 'Your admin session expired. Sign in again before uploading a map.',
                        'collection-not-found': 'Save the collection before uploading its map.',
                        'unsupported-image': 'The server could not read this image. Use a JPG, PNG, or WebP file.',
                        'persistence-unavailable': 'The server could not save the map.'
                    };
                    throw new Error(messages[result.error] || 'Could not upload the map. Check the connection and try again.');
                }
                setTaskCollections((current) => current.map((collection) => collection.id === selected.id
                    ? { ...collection, mapUrl: result.mapUrl }
                    : collection));
                setCollectionError('');
            }).catch((error) => {
                setCollectionError(error.message || 'Could not upload the map. Check the connection and try again.');
            }).finally(() => setMapUploadInProgress(false));
        });
    }

    async function removeCollectionMap() {
        const token = adminSessionTokenRef.current;
        if (!selectedTaskCollectionId || !token) return;
        setMapUploadInProgress(true);
        try {
            const response = await fetch(`/api/admin/collections/${encodeURIComponent(selectedTaskCollectionId)}/map`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) {
                throw new Error(result.error === 'persistence-unavailable'
                    ? 'The server could not remove the map.'
                    : 'Could not remove the map. Check the connection and try again.');
            }
            setTaskCollections((current) => current.map((collection) => collection.id === selectedTaskCollectionId
                ? { ...collection, mapUrl: null }
                : collection));
            setCollectionError('');
        } catch (error) {
            setCollectionError(error.message || 'Could not remove the map. Check the connection and try again.');
        } finally {
            setMapUploadInProgress(false);
        }
    }

    function addCollection() {
        const name = collectionName.trim();
        if (!name) {
            setCollectionError('Enter a name for the collection.');
            return;
        }
        if (taskCollections.some((collection) => collection.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
            setCollectionError('A collection with that name already exists.');
            return;
        }
        if (taskCollections.length >= 100) {
            setCollectionError('You can create up to 100 collections.');
            return;
        }
        const collection = { id: crypto.randomUUID(), name, tasks: [] };
        setTaskCollections((current) => [...current, collection]);
        setSelectedTaskCollectionId(collection.id);
        setTasks([]);
        setCollectionName('');
        setCollectionError('');
    }

    function deleteCollection() {
        if (taskCollections.length <= 1) {
            setCollectionError('Keep at least one task collection.');
            return;
        }
        const collection = taskCollections.find((item) => item.id === selectedTaskCollectionId);
        if (!collection || !window.confirm(`Delete the "${collection.name}" task collection?`)) return;
        const remaining = taskCollections.filter((item) => item.id !== selectedTaskCollectionId);
        setTaskCollections(remaining);
        setSelectedTaskCollectionId(remaining[0].id);
        setTasks(remaining[0].tasks);
        setCollectionError('');
    }

    function updateSelectedCollectionTasks(update) {
        const selected = taskCollections.find((collection) => collection.id === selectedTaskCollectionId);
        if (!selected) return;
        const nextTasks = update(selected.tasks);
        setTasks(nextTasks);
        setTaskCollections((current) => current.map((collection) => collection.id === selectedTaskCollectionId
            ? { ...collection, tasks: nextTasks }
            : collection));
        setCollectionError('');
    }

    function emergencyMeeting() {
        if (!socketRef.current?.connected) return;
        socketRef.current?.emit('emergency-meeting');
    }

    function continueGame() {
        if (!socketRef.current?.connected) return;
        socketRef.current?.emit('continue-game');
    }

    function endGame() {
        if (!socketRef.current?.connected) return;
        socketRef.current?.emit('end-game');
    }

    function removePlayer(player) {
        if (gameActive || !window.confirm(`Remove ${player.name} from the saved player list?`)) return;
        setPlayerManagementMessage('');
        socketRef.current?.timeout(10000).emit('remove-player', { playerId: player.id }, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                const messages = {
                    'game-active': 'Players cannot be removed while a game is in progress.',
                    'player-not-found': 'That player is no longer in the saved roster.',
                    'persistence-unavailable': 'The player could not be removed because the server could not save the change.'
                };
                setPlayerManagementMessage(messages[response?.reason] || 'Could not remove the player. Check the connection and try again.');
                return;
            }
            setPlayerManagementMessage(`${player.name} was removed.`);
        });
    }

    function login() {
        if (!adminCodeRef.current && !adminSessionTokenRef.current) {
            setLoginError('Enter the admin code.');
            return;
        }
        setLoginError('');
        forceCodeLoginRef.current = !!adminCodeRef.current;
        setIsAuthenticating(true);
        setLoginAttempt((attempt) => attempt + 1);
    }

    function logout() {
        socketRef.current?.timeout(10000).emit('admin-logout', (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                setLoginError('Could not safely end the admin session. Check the connection and try again.');
                return;
            }
            socketRef.current?.disconnect();
            adminSessionTokenRef.current = '';
            forceCodeLoginRef.current = true;
            try {
                localStorage.removeItem('adminSession');
            } catch (error) {
                console.warn('Could not clear the saved admin session.', error);
            }
            setAuthorized(false);
            setAdminCode('');
            setSessionExpiresAt(0);
            setLoginError('');
            setSessionWarning('');
        });
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

    if (!authorized) {
        return (
            <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
                <Card sx={{ width: '100%', maxWidth: 420 }}>
                    <CardContent>
                        <Stack spacing={2}>
                            <Typography variant="h6" gutterBottom>Admin Access</Typography>
                            {loginError && <Alert severity="error" role="alert">{loginError}</Alert>}
                            <TextField autoFocus label="Admin Code" type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} onKeyDown={(e) => {
                                if (e.key === 'Enter') login();
                            }} autoComplete="current-password" fullWidth />
                            <Button variant="contained" size="large" onClick={login} disabled={isAuthenticating}>
                                {isAuthenticating ? 'Checking…' : 'Enter'}
                            </Button>
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
            <Stack spacing={2} alignItems="stretch" sx={{ width: '100%', maxWidth: 1280, mx: 'auto', py: { xs: 1, sm: 3 }, px: { xs: 1, sm: 2 } }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="h5">Admin dashboard</Typography>
                        <Chip
                            size="small"
                            color={isConnected ? 'success' : 'default'}
                            label={isConnected ? 'Online' : 'Reconnecting'}
                        />
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Chip
                            color={meeting ? 'error' : gameActive ? 'primary' : 'default'}
                            label={meeting ? 'Meeting in progress' : gameActive ? 'Game in progress' : 'Game not started'}
                        />
                        <Button size="small" variant="outlined" onClick={logout} disabled={!isConnected}>Log out</Button>
                    </Stack>
                </Stack>
                {loginError && <Alert severity="warning">{loginError}</Alert>}
                {sessionWarning && <Alert severity="warning">{sessionWarning}</Alert>}
                {!isConnected && <Alert severity="warning">Connection to the game server is unavailable. Admin actions are disabled until it reconnects.</Alert>}
                {sessionExpiresAt > 0 && (
                    <Typography variant="caption" color="text.secondary">
                        Admin session valid until {new Date(sessionExpiresAt).toLocaleString()}
                    </Typography>
                )}
                {startError && <Alert severity="error">{startError}</Alert>}
                {playerManagementMessage && <Alert severity="info">{playerManagementMessage}</Alert>}
                {collectionError && <Alert severity="error">{collectionError}</Alert>}

                <Card>
                    <CardContent>
                        <Stack spacing={1}>
                            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                                <Typography variant="h6">Global task progress</Typography>
                                <Typography variant="body2">
                                    {globalProgress.completed} / {globalProgress.total} tasks
                                    {globalProgress.total > 0 ? ` · ${(globalProgress.ratio * 100).toFixed(0)}%` : ''}
                                </Typography>
                            </Stack>
                            <LinearProgress
                                variant="determinate"
                                value={globalProgress.ratio * 100}
                                aria-label="Global task progress"
                            />
                            {globalProgress.total === 0 && (
                                <Typography variant="caption" color="text.secondary">
                                    Progress appears when a game is in progress.
                                </Typography>
                            )}
                        </Stack>
                    </CardContent>
                </Card>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.2fr) minmax(360px, 0.8fr)' }, gap: 2, alignItems: 'start' }}>
                <Card sx={{ width: '100%', minWidth: 0 }}>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Players ({connectedPlayers.filter((player) => player.connected).length} connected / {connectedPlayers.length} total)
                        </Typography>
                        <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
                            {connectedPlayers.length === 0 ? (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                                    No players have logged in yet
                                </Typography>
                            ) : connectedPlayers.map((player) => (
                                <Paper key={player.id} variant="outlined" sx={{ p: 1.5 }}>
                                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography fontWeight={600} noWrap>{player.name || 'Unknown'}</Typography>
                                            <Chip
                                                size="small"
                                                color={player.connected ? 'success' : 'default'}
                                                label={`${player.connected ? 'Connected' : 'Offline'}${player.alive === false ? ' · Dead' : ''}`}
                                            />
                                        </Box>
                                        <IconButton
                                            aria-label={`Remove ${player.name}`}
                                            color="error"
                                            disabled={gameActive || !isConnected}
                                            onClick={() => removePlayer(player)}
                                        >
                                            <DeleteIcon />
                                        </IconButton>
                                    </Stack>
                                </Paper>
                            ))}
                        </Stack>
                        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 'min(60vh, 520px)', display: { xs: 'none', sm: 'block' } }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><strong>Name</strong></TableCell>
                                        <TableCell><strong>Status</strong></TableCell>
                                        <TableCell><strong>Actions</strong></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {connectedPlayers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} align="center">
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
                                                <TableCell>
                                                    <IconButton
                                                        aria-label={`Remove ${player.name}`}
                                                        color="error"
                                                        disabled={gameActive || !isConnected}
                                                        onClick={() => removePlayer(player)}
                                                        size="small"
                                                    >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </CardContent>
                </Card>

                <Card sx={{ width: '100%', minWidth: 0 }}>
                    <CardContent>
                        <Stack spacing={2} alignItems="stretch">
                            {showStart && (
                                <>
                                    <Typography variant="h6" alignSelf="flex-start">Task collections</Typography>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }}>
                                        <FormControl fullWidth>
                                            <InputLabel id="task-collection-label">Collection</InputLabel>
                                            <Select
                                                labelId="task-collection-label"
                                                label="Collection"
                                                value={selectedTaskCollectionId}
                                                onChange={(event) => {
                                                    const selected = taskCollections.find((collection) => collection.id === event.target.value);
                                                    setSelectedTaskCollectionId(event.target.value);
                                                    setTasks(selected?.tasks || []);
                                                    setCollectionError('');
                                                }}
                                            >
                                                {taskCollections.map((collection) => (
                                                    <MenuItem key={collection.id} value={collection.id}>
                                                        {collection.name} ({collection.tasks.length})
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <Stack direction="row" spacing={1}>
                                            <Button color="error" variant="outlined" onClick={deleteCollection} disabled={!isConnected || taskCollections.length <= 1}>
                                                Delete
                                            </Button>
                                            <Button
                                                component="label"
                                                variant="outlined"
                                                disabled={!isConnected || mapUploadInProgress}
                                            >
                                                {mapUploadInProgress ? 'Saving map…' : 'Upload map'}
                                                <input
                                                    hidden
                                                    type="file"
                                                    accept="image/jpeg,image/png,image/webp"
                                                    onChange={(event) => {
                                                        uploadCollectionMap(event.target.files?.[0]);
                                                        event.target.value = '';
                                                    }}
                                                />
                                            </Button>
                                        </Stack>
                                    </Stack>
                                    {(() => {
                                        const selectedCollection = taskCollections.find((collection) => collection.id === selectedTaskCollectionId);
                                        if (!selectedCollection) return null;
                                        return (
                                            <Paper variant="outlined" sx={{ p: 1.5 }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">
                                                        {selectedCollection.mapUrl ? 'Collection map' : 'Default map'}
                                                    </Typography>
                                                    <Box
                                                        component="img"
                                                        src={selectedCollection.mapUrl || '/images/MAP.JPG'}
                                                        alt={`${selectedCollection.name} map`}
                                                        sx={{
                                                            display: 'block',
                                                            width: '100%',
                                                            maxHeight: 240,
                                                            objectFit: 'contain',
                                                            bgcolor: 'action.hover',
                                                            borderRadius: 1
                                                        }}
                                                        onError={(event) => {
                                                            event.currentTarget.style.display = 'none';
                                                        }}
                                                    />
                                                    {selectedCollection.mapUrl && (
                                                        <Button
                                                            color="error"
                                                            size="small"
                                                            variant="text"
                                                            onClick={removeCollectionMap}
                                                            disabled={!isConnected || mapUploadInProgress}
                                                        >
                                                            Remove custom map
                                                        </Button>
                                                    )}
                                                </Stack>
                                            </Paper>
                                        );
                                    })()}
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }}>
                                        <TextField
                                            label="New collection name"
                                            value={collectionName}
                                            onChange={(event) => setCollectionName(event.target.value)}
                                            inputProps={{ maxLength: 64 }}
                                            fullWidth
                                        />
                                        <Button variant="outlined" onClick={addCollection} sx={{ flexShrink: 0 }}>Add</Button>
                                    </Stack>
                                    <Button variant="outlined" onClick={() => saveTaskCollections()} disabled={!isConnected || !taskCollections.length}>
                                        Save collections
                                    </Button>
                                    <Divider sx={{ width: '100%' }} />
                                    <TextField label="Number of Impostors" value={numImpostors} onChange={(e) => setNumImpostors(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Tasks per Player" value={numTasksPerPlayer} onChange={(e) => setNumTasksPerPlayer(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Emergency Cooldown (minutes)" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="decimal" fullWidth />
                                    <TextField label="Kill Cooldown (seconds)" value={killCooldownSeconds} onChange={(e) => setKillCooldownSeconds(e.target.value)} inputMode="decimal" fullWidth />
                                    <TextField label="Sabotage Duration (seconds)" value={sabotageSeconds} onChange={(e) => setSabotageSeconds(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Sabotage Charges (shared)" value={sabotageCharges} onChange={(e) => setSabotageCharges(e.target.value)} inputMode="numeric" fullWidth />
                                    <TextField label="Max Players per Task" value={maxPlayersPerTask} onChange={(e) => setMaxPlayersPerTask(e.target.value)} inputMode="numeric" fullWidth />
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                        <TextField label="Task" value={taskName} onChange={(e) => setTaskName(e.target.value)} fullWidth />
                                        <TextField label="Location (optional)" value={taskLocation} onChange={(e) => setTaskLocation(e.target.value)} fullWidth />
                                        <Button variant="contained" onClick={() => {
                                            const name = taskName.trim();
                                            const loc = taskLocation.trim();
                                            if (!name) return;
                                            const label = loc ? `${name} (${loc})` : name;
                                            updateSelectedCollectionTasks((current) => [...current, label]);
                                            setTaskName('');
                                            setTaskLocation('');
                                        }} sx={{ minWidth: { sm: 80 } }}>Add task</Button>
                                    </Stack>
                                    <Paper variant="outlined" sx={{ width: '100%', maxHeight: 'min(40vh, 320px)', overflowY: 'auto' }}>
                                        <List dense disablePadding>
                                            {tasks.map((t, idx) => (
                                                <ListItem
                                                    key={`${selectedTaskCollectionId}-${idx}`}
                                                    sx={{ borderBottom: idx < tasks.length - 1 ? 1 : 0, borderColor: 'divider' }}
                                                    secondaryAction={
                                                        <IconButton edge="end" aria-label={`Delete task ${t}`} onClick={() => updateSelectedCollectionTasks((current) => current.filter((_, i) => i !== idx))}>
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    }
                                                >
                                                    <ListItemText primary={t} sx={{ pr: 2, overflowWrap: 'anywhere' }} />
                                                </ListItem>
                                            ))}
                                            {tasks.length === 0 && (
                                                <ListItem>
                                                    <ListItemText primary="No tasks yet. Add some above." />
                                                </ListItem>
                                            )}
                                        </List>
                                    </Paper>
                                    <Button variant="contained" color="primary" size="large" id="start-game" onClick={startGameWithConfig} disabled={!isConnected || !selectedTaskCollectionId || !tasks.length}>
                                        Start Game · {taskCollections.find((collection) => collection.id === selectedTaskCollectionId)?.name || 'Select a collection'}
                                    </Button>
                                </>
                            )}
                            {showEmergency && (
                                <Button variant="outlined" color="error" onClick={emergencyMeeting} disabled={!isConnected || cooldownRemainingMs > 0}>
                                    {cooldownRemainingMs > 0 ? `Emergency Cooldown (${Math.ceil(cooldownRemainingMs / 1000)}s)` : 'Emergency Meeting (Space)'}
                                </Button>
                            )}
                            {showContinue && (
                                <>
                                    <Typography variant="h5" color="error">MEETING TIME</Typography>
                                    <Button variant="contained" onClick={continueGame} disabled={!isConnected}>Continue</Button>
                                </>
                            )}
                            {gameActive && (
                                <Button variant="outlined" color="error" onClick={endGame} disabled={!isConnected}>End Game</Button>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
                </Box>
            </Stack>
        </>
    );
}