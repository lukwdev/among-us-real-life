
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

function splitTaskLabel(label) {
    if (label && typeof label === 'object') {
        return {
            task: label.label || '',
            room: label.room || '',
            type: label.type || 'manual',
            qrCodes: Array.isArray(label.qrCodes) ? label.qrCodes : [],
            isbnCount: label.isbnCount || 1,
            id: label.id
        };
    }
    const match = /^(.*)\s+\(([^()]*)\)$/.exec(label || '');
    return match ? { task: match[1], room: match[2], type: 'manual', qrCodes: [], isbnCount: 1 } : { task: label || '', room: '', type: 'manual', qrCodes: [], isbnCount: 1 };
}

function joinTaskLabel(task, room, type = 'manual', options = {}) {
    return {
        id: options.id || crypto.randomUUID(),
        label: task.trim(),
        room: room.trim(),
        type,
        ...(type === 'qr' ? { qrCodes: options.qrCodes || [] } : {}),
        ...(type === 'isbn' ? { isbnCount: Number(options.isbnCount) || 1 } : {})
    };
}

function downloadQrCode(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
}

function TaskCollectionEditor({
    taskCollections,
    selectedTaskCollectionId,
    selectTaskCollection,
    collectionName,
    setCollectionName,
    tasks,
    taskName,
    setTaskName,
    taskLocation,
    setTaskLocation,
    taskType,
    setTaskType,
    taskCodes,
    setTaskCodes,
    isbnCount,
    setIsbnCount,
    collectionsDirty,
    isConnected,
    mapUploadInProgress,
    collectionError,
    addCollection,
    deleteCollection,
    saveTaskCollections,
    uploadCollectionMap,
    removeCollectionMap,
    updateSelectedCollectionTasks,
    openQrGenerator
}) {
    const selectedCollection = taskCollections.find((collection) => collection.id === selectedTaskCollectionId);

    return (
        <Accordion sx={{ width: '100%', minWidth: 0 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 1.5 }} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Typography variant="h6">Task collections</Typography>
                    {selectedCollection && (
                        <Typography variant="body2" color="text.secondary">
                            {selectedCollection.name}
                        </Typography>
                    )}
                    <Chip
                        size="small"
                        color={collectionsDirty ? 'warning' : 'success'}
                        label={collectionsDirty ? 'Unsaved changes' : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
                    />
                </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
                <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
                        <Box>
                            <Typography variant="body2" color="text.secondary">
                                Edit task and room details directly. Save your changes before starting a game.
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                            <Chip
                                size="small"
                                color={collectionsDirty ? 'warning' : 'success'}
                                label={collectionsDirty ? 'Unsaved changes' : 'All changes saved'}
                            />
                            <Button
                                variant="contained"
                                onClick={() => saveTaskCollections()}
                                disabled={!isConnected || !collectionsDirty}
                            >
                                Save task changes
                            </Button>
                        </Stack>
                    </Stack>

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
                        <FormControl fullWidth>
                            <InputLabel id="task-collection-label">Collection</InputLabel>
                            <Select
                                labelId="task-collection-label"
                                label="Collection"
                                value={selectedTaskCollectionId}
                                onChange={(event) => selectTaskCollection(event.target.value)}
                            >
                                {taskCollections.map((collection) => (
                                    <MenuItem key={collection.id} value={collection.id}>
                                        {collection.name} ({collection.tasks.length})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                            <Button color="error" variant="outlined" onClick={deleteCollection} disabled={!isConnected || taskCollections.length <= 1}>
                                Delete
                            </Button>
                            <Button component="label" variant="outlined" disabled={!isConnected || mapUploadInProgress}>
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

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
                        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <TextField
                                    label="New collection name"
                                    value={collectionName}
                                    onChange={(event) => setCollectionName(event.target.value)}
                                    inputProps={{ maxLength: 64 }}
                                    fullWidth
                                />
                                <Button variant="outlined" onClick={addCollection} sx={{ flexShrink: 0 }}>Add collection</Button>
                            </Stack>
                        </Box>
                        {selectedCollection && (
                            <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 0', minWidth: 0 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                    <Box
                                        component="img"
                                        src={selectedCollection.mapUrl || '/images/MAP.JPG'}
                                        alt={`${selectedCollection.name} map`}
                                        sx={{
                                            display: 'block',
                                            width: { xs: '100%', sm: 180 },
                                            height: 110,
                                            objectFit: 'contain',
                                            bgcolor: 'action.hover',
                                            borderRadius: 1
                                        }}
                                        onError={(event) => {
                                            event.currentTarget.style.display = 'none';
                                        }}
                                    />
                                    <Stack spacing={0.5}>
                                        <Typography variant="subtitle2">
                                            {selectedCollection.mapUrl ? 'Collection map' : 'Default map'}
                                        </Typography>
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
                                </Stack>
                            </Paper>
                        )}
                    </Stack>

                    <Stack spacing={1}>
                        <Typography variant="subtitle1">Add task</Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField label="Task" value={taskName} onChange={(event) => setTaskName(event.target.value)} fullWidth />
                            <TextField label="Room (optional)" value={taskLocation} onChange={(event) => setTaskLocation(event.target.value)} fullWidth />
                            <Button
                                variant="contained"
                                onClick={() => {
                                    const name = taskName.trim();
                                    const room = taskLocation.trim();
                                    if (!name) return;
                                    updateSelectedCollectionTasks((current) => [...current, joinTaskLabel(name, room, taskType, {
                                        qrCodes: taskCodes.split(',').map((code) => code.trim()).filter(Boolean),
                                        isbnCount
                                    })]);
                                    setTaskName('');
                                    setTaskLocation('');
                                    setTaskCodes('');
                                    setIsbnCount('1');
                                }}
                                sx={{ minWidth: { sm: 100 } }}
                            >
                                Add task
                            </Button>
                        </Stack>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <FormControl fullWidth>
                                <InputLabel id="task-type-label">Type</InputLabel>
                                <Select labelId="task-type-label" label="Type" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                                    <MenuItem value="manual">Physical / self-confirmed</MenuItem>
                                    <MenuItem value="qr">QR action</MenuItem>
                                    <MenuItem value="isbn">ISBN collection</MenuItem>
                                </Select>
                            </FormControl>
                            {taskType === 'qr' && <TextField label="Expected QR values (comma separated)" value={taskCodes} onChange={(event) => setTaskCodes(event.target.value)} fullWidth />}
                            {taskType === 'isbn' && <TextField label="ISBN count" value={isbnCount} onChange={(event) => setIsbnCount(event.target.value)} inputMode="numeric" fullWidth />}
                        </Stack>
                    </Stack>

                    <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', maxHeight: 'min(55vh, 560px)' }}>
                        <Table size="small" stickyHeader aria-label="Editable task collection">
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ minWidth: 200, width: '60%' }}>Task</TableCell>
                                    <TableCell sx={{ minWidth: 160, width: '35%' }}>Room</TableCell>
                                    <TableCell sx={{ minWidth: 150 }}>Type</TableCell>
                                    <TableCell align="right" sx={{ width: 56 }}>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {tasks.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} align="center">
                                            <Typography variant="body2" color="text.secondary">No tasks yet. Add one above.</Typography>
                                        </TableCell>
                                    </TableRow>
                                ) : tasks.map((label, idx) => {
                                    const { task, room, type, qrCodes, isbnCount: taskIsbnCount, id } = splitTaskLabel(label);
                                    return (
                                        <TableRow key={`${selectedTaskCollectionId}-${id || idx}`}>
                                            <TableCell>
                                                <TextField
                                                    aria-label={`Task ${idx + 1}`}
                                                    value={task}
                                                    onChange={(event) => {
                                                        const nextTask = event.target.value;
                                                        updateSelectedCollectionTasks((current) => current.map((entry, entryIndex) =>
                                                            entryIndex === idx ? joinTaskLabel(nextTask, room, type, { id, qrCodes, isbnCount: taskIsbnCount }) : entry
                                                        ));
                                                    }}
                                                    inputProps={{ maxLength: 200 }}
                                                    variant="standard"
                                                    fullWidth
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <TextField
                                                    aria-label={`Room for task ${idx + 1}`}
                                                    value={room}
                                                    onChange={(event) => {
                                                        const nextRoom = event.target.value;
                                                        updateSelectedCollectionTasks((current) => current.map((entry, entryIndex) =>
                                                            entryIndex === idx ? joinTaskLabel(task, nextRoom, type, { id, qrCodes, isbnCount: taskIsbnCount }) : entry
                                                        ));
                                                    }}
                                                    inputProps={{ maxLength: 64 }}
                                                    variant="standard"
                                                    fullWidth
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <Chip size="small" label={type === 'isbn' ? `ISBN ×${taskIsbnCount}` : type === 'qr' ? `QR ×${qrCodes.length}` : 'Physical'} />
                                                    {type === 'qr' && (
                                                        <Button size="small" onClick={() => openQrGenerator(qrCodes, task)}>
                                                            QR codes
                                                        </Button>
                                                    )}
                                                </Stack>
                                            </TableCell>
                                            <TableCell align="right">
                                                <IconButton
                                                    aria-label={`Delete task ${task}`}
                                                    color="error"
                                                    size="small"
                                                    onClick={() => updateSelectedCollectionTasks((current) => current.filter((_, entryIndex) => entryIndex !== idx))}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} in this collection
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                {collectionsDirty ? 'Remember to save before leaving this page.' : 'Your collection changes are saved.'}
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={() => saveTaskCollections()}
                                disabled={!isConnected || !collectionsDirty}
                            >
                                Save changes
                            </Button>
                        </Stack>
                    </Stack>
                    {collectionError && <Alert severity="error">{collectionError}</Alert>}
                </Stack>
            </AccordionDetails>
        </Accordion>
    );
}

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
    const [gameWinner, setGameWinner] = useState(null);
    const [numImpostors, setNumImpostors] = useState('1');
    const [numTasksPerPlayer, setNumTasksPerPlayer] = useState('5');
    const [taskName, setTaskName] = useState('');
    const [taskLocation, setTaskLocation] = useState('');
    const [taskType, setTaskType] = useState('manual');
    const [taskCodes, setTaskCodes] = useState('');
    const [isbnCount, setIsbnCount] = useState('5');
    const [tasks, setTasks] = useState([]);
    const [taskCollections, setTaskCollections] = useState([]);
    const [collectionsDirty, setCollectionsDirty] = useState(false);
    const [selectedTaskCollectionId, setSelectedTaskCollectionId] = useState('');
    const [collectionName, setCollectionName] = useState('');
    const [collectionError, setCollectionError] = useState('');
    const [cooldownMinutes, setCooldownMinutes] = useState('0');
    const [killCooldownSeconds, setKillCooldownSeconds] = useState('0');
    const [maxPlayersPerTask, setMaxPlayersPerTask] = useState('2');
    const [sabotageSeconds, setSabotageSeconds] = useState('60');
    const [sabotageCharges, setSabotageCharges] = useState('2');
    const [sabotageMode, setSabotageMode] = useState('button');
    const [sabotageQrCodes, setSabotageQrCodes] = useState('');
    const [qrDialog, setQrDialog] = useState({ open: false, title: '', values: [], images: [] });
    const [deadTaskCompletionIntervalSeconds, setDeadTaskCompletionIntervalSeconds] = useState('90');
    const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
    const [connectedPlayers, setConnectedPlayers] = useState([]);
    const [startError, setStartError] = useState('');
    const [playerManagementMessage, setPlayerManagementMessage] = useState('');
    const [globalProgress, setGlobalProgress] = useState({ completed: 0, total: 0, ratio: 0 });
    const [playerJoinCode, setPlayerJoinCode] = useState('');
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
                        'persistence-unavailable': 'The server could not save your admin session.',
                        'rate-limited': `Too many login attempts. Please wait ${response?.retryAfterSec ?? 120} seconds before trying again.`
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
        socket.on('game-won', (result) => {
            if (['crewmates', 'impostors'].includes(result?.winner)) setGameWinner(result.winner);
        });
        socket.on('state', (s) => {
            setMeeting(!!s?.isMeeting);
            setGameActive(!!s?.isGameActive);
            setGameWinner(['crewmates', 'impostors'].includes(s?.gameWinner) ? s.gameWinner : null);
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
                if (s.config.sabotageMode === 'button' || s.config.sabotageMode === 'qr') setSabotageMode(s.config.sabotageMode);
                if (Array.isArray(s.config.sabotageQrCodes)) setSabotageQrCodes(s.config.sabotageQrCodes.join(', '));
                if (typeof s.config.deadTaskCompletionIntervalSeconds === 'number') {
                    setDeadTaskCompletionIntervalSeconds(String(s.config.deadTaskCompletionIntervalSeconds));
                }
            }
            if (Array.isArray(s?.taskCollections)) {
                setTaskCollections(s.taskCollections);
                setCollectionsDirty(false);
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
            if (typeof s?.playerJoinCode === 'string') {
                setPlayerJoinCode(s.playerJoinCode);
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
                'invalid-task-collection': 'Select a valid task collection before starting.',
                'invalid-sabotage-qr-config': 'QR sabotage needs at least two QR values.'
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
            sabotageCharges: Number.isFinite(parseInt(sabotageCharges, 10)) ? parseInt(sabotageCharges, 10) : undefined,
            sabotageMode,
            sabotageQrCodes: sabotageQrCodes.split(',').map((code) => code.trim()).filter(Boolean),
            deadTaskCompletionIntervalSeconds: Number.isFinite(parseInt(deadTaskCompletionIntervalSeconds, 10))
                ? parseInt(deadTaskCompletionIntervalSeconds, 10)
                : undefined
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
            setCollectionsDirty(false);
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
                    Authorization: 'Bearer ' + token,
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
                headers: { Authorization: 'Bearer ' + token }
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
        setCollectionsDirty(true);
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
        setCollectionsDirty(true);
        setSelectedTaskCollectionId(remaining[0].id);
        setTasks(remaining[0].tasks);
        setCollectionError('');
    }

    function updateSelectedCollectionTasks(update) {
        const selected = taskCollections.find((collection) => collection.id === selectedTaskCollectionId);
        if (!selected) return;
        const nextTasks = update(selected.tasks);
        setTasks(nextTasks);
        setCollectionsDirty(true);
        setTaskCollections((current) => current.map((collection) => collection.id === selectedTaskCollectionId
            ? { ...collection, tasks: nextTasks }
            : collection));
        setCollectionError('');
    }

    async function openQrGenerator(values, title) {
        const uniqueValues = [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
        const images = await Promise.all(uniqueValues.map((value) => QRCode.toDataURL(value, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 360
        })));
        setQrDialog({ open: true, title, values: uniqueValues, images });
    }

    function selectTaskCollection(collectionId) {
        const selected = taskCollections.find((collection) => collection.id === collectionId);
        if (!selected) return;
        setSelectedTaskCollectionId(collectionId);
        setTasks(selected.tasks);
        setCollectionsDirty(true);
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

    function ejectPlayer(player) {
        if (!gameActive || player.alive === false || !window.confirm(`Eliminate ${player.name}?`)) return;
        setPlayerManagementMessage('');
        socketRef.current?.timeout(10000).emit('admin-eject-player', { playerId: player.id }, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                setPlayerManagementMessage('Could not eliminate the player.');
                return;
            }
            setPlayerManagementMessage(`${player.name} was eliminated.`);
        });
    }

    async function exportBooks() {
        const token = adminSessionTokenRef.current;
        if (!token) return;
        const response = await fetch('/api/admin/books.csv', { headers: { Authorization: 'Bearer ' + token } });
        if (!response.ok) {
            setPlayerManagementMessage('Could not export the ISBN list. Your admin session may have expired.');
            return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'among-us-books.csv';
        link.click();
        URL.revokeObjectURL(url);
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
            <Stack spacing={2} alignItems="stretch" sx={{ width: '100%', maxWidth: 1600, mx: 'auto', py: { xs: 1, sm: 3 }, px: { xs: 0, sm: 1 } }}>
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
                            color={meeting ? 'error' : gameWinner === 'crewmates' ? 'success' : gameWinner === 'impostors' ? 'error' : gameActive ? 'primary' : 'default'}
                            label={meeting ? 'Meeting in progress' : gameActive ? 'Game in progress' : gameWinner ? `${gameWinner === 'crewmates' ? 'Crewmates' : 'Impostors'} won` : 'Game not started'}
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
                {playerJoinCode && (
                    <Card
                        sx={{
                            border: 2,
                            borderColor: 'primary.dark',
                            bgcolor: 'primary.dark',
                            color: 'common.white'
                        }}
                    >
                        <CardContent sx={{ py: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={{ xs: 1, sm: 2 }}
                                alignItems={{ xs: 'stretch', sm: 'center' }}
                                justifyContent="space-between"
                            >
                                <Box>
                                    <Typography variant="overline" fontWeight={700}>
                                        Player access code
                                    </Typography>
                                    <Typography variant="body2">
                                        Share this code with players before they join.
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography
                                        component="code"
                                        sx={{
                                            px: 1.5,
                                            py: 0.75,
                                            borderRadius: 1,
                                            bgcolor: 'common.white',
                                            color: '#111827',
                                            fontSize: { xs: '1.75rem', sm: '2rem' },
                                            fontWeight: 800,
                                            letterSpacing: '0.18em',
                                            lineHeight: 1
                                        }}
                                    >
                                        {playerJoinCode}
                                    </Typography>
                                    <Tooltip title="Copy player access code">
                                        <IconButton
                                            aria-label="Copy player access code"
                                            onClick={() => navigator.clipboard?.writeText(playerJoinCode)}
                                            sx={{ color: 'common.white' }}
                                        >
                                            <ContentCopyIcon />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                )}
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
                {showStart && (
                    <TaskCollectionEditor
                        taskCollections={taskCollections}
                        selectedTaskCollectionId={selectedTaskCollectionId}
                        selectTaskCollection={selectTaskCollection}
                        collectionName={collectionName}
                        setCollectionName={setCollectionName}
                        tasks={tasks}
                        taskName={taskName}
                        setTaskName={setTaskName}
                        taskLocation={taskLocation}
                        setTaskLocation={setTaskLocation}
                        taskType={taskType}
                        setTaskType={setTaskType}
                        taskCodes={taskCodes}
                        setTaskCodes={setTaskCodes}
                        isbnCount={isbnCount}
                        setIsbnCount={setIsbnCount}
                        collectionsDirty={collectionsDirty}
                        isConnected={isConnected}
                        mapUploadInProgress={mapUploadInProgress}
                        collectionError={collectionError}
                        addCollection={addCollection}
                        deleteCollection={deleteCollection}
                        saveTaskCollections={saveTaskCollections}
                        uploadCollectionMap={uploadCollectionMap}
                        removeCollectionMap={removeCollectionMap}
                        updateSelectedCollectionTasks={updateSelectedCollectionTasks}
                        openQrGenerator={openQrGenerator}
                    />
                )}

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.15fr) minmax(360px, 0.85fr)' }, gap: 2, alignItems: 'start' }}>
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
                                            <Stack direction="row" spacing={0.75} alignItems="center">
                                                <Typography fontWeight={600} noWrap>{player.name || 'Unknown'}</Typography>
                                                {player.alive === false && (
                                                    <Tooltip title="Eliminated">
                                                        <Typography component="span" color="error.main" aria-label="Eliminated" sx={{ lineHeight: 1 }}>
                                                            💀
                                                        </Typography>
                                                    </Tooltip>
                                                )}
                                            </Stack>
                                            <Chip
                                                size="small"
                                                color={player.connected ? 'success' : 'default'}
                                                label={player.connected ? 'Connected' : 'Offline'}
                                            />
                                        </Box>
                                        {gameActive ? (
                                            player.alive !== false && (
                                                <Button
                                                    size="small"
                                                    color="error"
                                                    variant="outlined"
                                                    disabled={!isConnected}
                                                    onClick={() => ejectPlayer(player)}
                                                >
                                                    Eliminate
                                                </Button>
                                            )
                                        ) : (
                                            <IconButton
                                                aria-label={`Remove ${player.name}`}
                                                color="error"
                                                disabled={gameActive || !isConnected}
                                                onClick={() => removePlayer(player)}
                                            >
                                                <DeleteIcon />
                                            </IconButton>
                                        )}
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
                                                <TableCell>
                                                    <Stack direction="row" spacing={0.75} alignItems="center">
                                                        <Typography>{player.name || 'Unknown'}</Typography>
                                                        {player.alive === false && (
                                                            <Tooltip title="Eliminated">
                                                                <Typography component="span" color="error.main" aria-label="Eliminated" sx={{ lineHeight: 1 }}>
                                                                    💀
                                                                </Typography>
                                                            </Tooltip>
                                                        )}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>
                                                    <Typography color={player.connected ? 'success.main' : 'text.secondary'}>
                                                        {player.connected ? 'Connected' : 'Offline'}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    {gameActive ? (
                                                        player.alive !== false && (
                                                            <Button
                                                                size="small"
                                                                color="error"
                                                                variant="outlined"
                                                                disabled={!isConnected}
                                                                onClick={() => ejectPlayer(player)}
                                                            >
                                                                Eliminate
                                                            </Button>
                                                        )
                                                    ) : (
                                                        <IconButton
                                                            aria-label={`Remove ${player.name}`}
                                                            color="error"
                                                            disabled={gameActive || !isConnected}
                                                            onClick={() => removePlayer(player)}
                                                            size="small"
                                                        >
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    )}
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
                                    <Typography variant="h6">Game settings</Typography>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
                                        <TextField label="Number of Impostors" value={numImpostors} onChange={(e) => setNumImpostors(e.target.value)} inputMode="numeric" fullWidth />
                                        <TextField label="Tasks per Player" value={numTasksPerPlayer} onChange={(e) => setNumTasksPerPlayer(e.target.value)} inputMode="numeric" fullWidth />
                                        <TextField label="Emergency Cooldown (minutes)" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="decimal" fullWidth />
                                        <TextField label="Kill Cooldown (seconds)" value={killCooldownSeconds} onChange={(e) => setKillCooldownSeconds(e.target.value)} inputMode="decimal" fullWidth />
                                        <TextField label="Sabotage Duration (seconds)" value={sabotageSeconds} onChange={(e) => setSabotageSeconds(e.target.value)} inputMode="numeric" fullWidth />
                                        <TextField label="Sabotage Charges (shared)" value={sabotageCharges} onChange={(e) => setSabotageCharges(e.target.value)} inputMode="numeric" fullWidth />
                                        <FormControl fullWidth>
                                            <InputLabel id="sabotage-mode-label">Sabotage mode</InputLabel>
                                            <Select labelId="sabotage-mode-label" label="Sabotage mode" value={sabotageMode} onChange={(e) => setSabotageMode(e.target.value)}>
                                                <MenuItem value="button">Current: two players press</MenuItem>
                                                <MenuItem value="qr">Two QR codes</MenuItem>
                                            </Select>
                                        </FormControl>
                                        {sabotageMode === 'qr' && (
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ gridColumn: '1 / -1' }}>
                                                <TextField
                                                    label="Sabotage QR values (two, comma separated)"
                                                    value={sabotageQrCodes}
                                                    onChange={(e) => setSabotageQrCodes(e.target.value)}
                                                    helperText="Each code must be scanned once; values are not shown to players."
                                                    fullWidth
                                                />
                                                <Button
                                                    variant="outlined"
                                                    onClick={() => openQrGenerator(sabotageQrCodes.split(',').map((code) => code.trim()), 'Sabotage QR codes')}
                                                >
                                                    Generate QR codes
                                                </Button>
                                            </Stack>
                                        )}
                                        <TextField label="Max Players per Task" value={maxPlayersPerTask} onChange={(e) => setMaxPlayersPerTask(e.target.value)} inputMode="numeric" fullWidth />
                                        <TextField
                                            label="Dead Player Task Interval (seconds)"
                                            value={deadTaskCompletionIntervalSeconds}
                                            onChange={(e) => setDeadTaskCompletionIntervalSeconds(e.target.value)}
                                            inputMode="numeric"
                                            inputProps={{ min: 1 }}
                                            helperText="One unfinished task from a dead crewmate is completed after each interval."
                                            fullWidth
                                        />
                                    </Box>
                                    <Button variant="contained" color="primary" size="large" id="start-game" onClick={startGameWithConfig} disabled={!isConnected || !selectedTaskCollectionId || !tasks.length}>
                                        Start Game · {taskCollections.find((collection) => collection.id === selectedTaskCollectionId)?.name || 'Select a collection'}
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        onClick={exportBooks}
                                    >
                                        Export ISBNs
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
                                    <Typography variant="h5" color="error">MEETING IN PROGRESS</Typography>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                        <Button variant="outlined" color="warning" onClick={() => socketRef.current?.emit('admin-end-voting')} disabled={!isConnected}>
                                            End Voting & Tally
                                        </Button>
                                        <Button variant="contained" onClick={continueGame} disabled={!isConnected}>
                                            Continue Game
                                        </Button>
                                    </Stack>
                                </>
                            )}
                            {(gameActive || gameWinner) && (
                                <Button variant="outlined" color="error" onClick={endGame} disabled={!isConnected}>End Game</Button>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
                </Box>
            </Stack>
            <Snackbar
                open={!!gameWinner}
                autoHideDuration={6000}
                onClose={() => setGameWinner(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setGameWinner(null)}
                    severity={gameWinner === 'crewmates' ? 'success' : 'error'}
                    variant="filled"
                >
                    {gameWinner === 'crewmates' ? 'Crewmates' : 'Impostors'} win!
                </Alert>
            </Snackbar>
            <Dialog
                open={qrDialog.open}
                onClose={() => setQrDialog((current) => ({ ...current, open: false }))}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>{qrDialog.title}</DialogTitle>
                <DialogContent>
                    {qrDialog.values.length === 0 ? (
                        <Alert severity="warning">Enter at least one QR value first.</Alert>
                    ) : (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" flexWrap="wrap">
                            {qrDialog.images.map((image, index) => (
                                <Paper key={`${qrDialog.values[index]}-${index}`} variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                                    <Box component="img" src={image} alt={`QR code for ${qrDialog.values[index]}`} sx={{ width: 260, maxWidth: '100%' }} />
                                    <Typography variant="body2" sx={{ wordBreak: 'break-all', maxWidth: 260 }}>
                                        {qrDialog.values[index]}
                                    </Typography>
                                    <Button size="small" onClick={() => downloadQrCode(image, `qr-code-${index + 1}.png`)}>
                                        Download PNG
                                    </Button>
                                </Paper>
                            ))}
                        </Stack>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => window.print()} disabled={!qrDialog.images.length}>Print</Button>
                    <Button onClick={() => setQrDialog((current) => ({ ...current, open: false }))}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
