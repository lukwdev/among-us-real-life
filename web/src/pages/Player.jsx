import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Alert, Backdrop, Box, Button, Card, CardContent, Checkbox, FormControlLabel, IconButton, LinearProgress, List, ListItem, ListItemText, Snackbar, Stack, TextField, Tooltip, Typography, Dialog, DialogContent } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';

function WinnerSnackbar({ winner, onClose }) {
  if (!winner) return null;
  const winnerName = winner === 'crewmates' ? 'Crewmates' : 'Impostors';
  return (
    <Snackbar open autoHideDuration={6000} onClose={onClose} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Alert onClose={onClose} severity={winner === 'crewmates' ? 'success' : 'error'} variant="filled">
        {winnerName} win!
      </Alert>
    </Snackbar>
  );
}

function decodeVapidKey(key) {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export default function Player() {
  const [tasks, setTasks] = useState({});
  const [completed, setCompleted] = useState({});
  const [progress, setProgress] = useState(0);
  const [role, setRole] = useState('');
  const [authId, setAuthId] = useState('');
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('playerName') || '';
    } catch {
      return '';
    }
  });
  const [nameInput, setNameInput] = useState(playerName);
  const [playerCode, setPlayerCode] = useState(() => {
    try {
      return localStorage.getItem('playerJoinCode') || '';
    } catch {
      return '';
    }
  });
  const [playerCodeRequired, setPlayerCodeRequired] = useState(true);
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [loginError, setLoginError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [pushSubscriptionSaved, setPushSubscriptionSaved] = useState(false);
  const audioRef = useRef(null);
  const socketRef = useRef(null);
  const authIdRef = useRef(authId);
  authIdRef.current = authId;
  const pushReadyRef = useRef(false);
  pushReadyRef.current = pushEnabled && pushSubscriptionSaved;
  const playerActionsRef = useRef({});
  const [meeting, setMeeting] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [gameWinner, setGameWinner] = useState(null);
  const [isDead, setIsDead] = useState(false);
  const [isImpostor, setIsImpostor] = useState(false);
  const [killCooldownRemainingMs, setKillCooldownRemainingMs] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapUrl, setMapUrl] = useState('');
  const [audioReady, setAudioReady] = useState(false);
  const [sabotageEndMs, setSabotageEndMs] = useState(0);
  const isSabotageActive = sabotageEndMs > Date.now();
  const [sabotageChargesRemaining, setSabotageChargesRemaining] = useState(0);
  // Stopwatch state
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchMs, setStopwatchMs] = useState(0);
  const swLastTickRef = useRef(0);
  const playerCodeRef = useRef(playerCode);
  playerCodeRef.current = playerCode;

  useEffect(() => {
    fetch('/api/player-auth-config')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((config) => setPlayerCodeRequired(config.required !== false))
      .catch((error) => {
        console.warn('Could not load player access configuration; keeping access code required.', error);
        setPlayerCodeRequired(true);
      });
  }, []);

  useEffect(() => {
    if (!playerName) return;
    const socket = io({ query: { role: 'PLAYER' } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(false);
      socket.timeout(10000).emit('player-login', { name: playerName, code: playerCodeRef.current }, (timeoutError, response) => {
        if (timeoutError || !response?.ok) {
          const messages = {
            'invalid-name': 'Enter a name between 1 and 32 characters.',
            'name-in-use': 'That name is already connected. Choose a different name.',
            'invalid-player-code': 'The player access code is incorrect.',
            'player-code-not-configured': 'The server has not configured a player access code.',
            'persistence-unavailable': 'The server could not save your player profile. Please try again later.'
          };
          if (response?.reason === 'invalid-player-code') {
            try {
              localStorage.removeItem('playerJoinCode');
            } catch (error) {
              console.warn('Could not clear the invalid player access code.', error);
            }
            setPlayerCode('');
          }
          setLoginError(messages[response?.reason] || 'Could not connect to the game. Please try again.');
          socket.disconnect();
          return;
        }
        setLoginError('');
        setAuthId(response.id);
        setIsConnected(true);
        try {
          localStorage.setItem('playerName', response.name);
          if (playerCodeRef.current) {
            localStorage.setItem('playerJoinCode', playerCodeRef.current);
          }
        } catch {
          console.warn('Could not save the player credentials in browser storage.');
        }
        socket.timeout(5000).emit('get-push-config', (configError, config) => {
          if (configError) {
            setPushMessage('Could not check notification support. Reconnect and try again.');
            return;
          }
          if (!config?.enabled) {
            setPushMessage('Notifications are not configured on the server.');
            return;
          }
          if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) {
            setPushMessage('Push notifications require HTTPS and a supported browser.');
            return;
          }
          setPushEnabled(true);
          setPushPublicKey(config.publicKey);
          if (Notification.permission === 'granted') {
            syncPushSubscription(socket, config.publicKey);
          } else if (Notification.permission === 'denied') {
            setPushMessage('Notifications are blocked in your browser settings.');
          }
        });
      });
    });
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('player-removed', () => {
      try {
        localStorage.removeItem('playerName');
        localStorage.removeItem('playerJoinCode');
        localStorage.removeItem(`imp_completed_${authIdRef.current}`);
      } catch (error) {
        console.warn('Could not clear saved player data after roster removal.', error);
      }
      setPlayerName('');
      setNameInput('');
      setAuthId('');
      setTasks({});
      setCompleted({});
      setRole('');
      setIsImpostor(false);
      setLoginError('Your saved player profile was removed by the admin. Enter your name to join again.');
      socket.disconnect();
    });

    socket.on('tasks', (t) => { setTasks(t || {}); });
    socket.on('progress', (p) => { setProgress(p || 0); });
    socket.on('tasks-completed', (m) => { setCompleted(m || {}); });
    socket.on('role', (r) => { setRole(r || ''); setIsImpostor(r === 'Impostor'); });
    socket.on('play-meeting', async () => {
      await playerActionsRef.current.playSound('/sounds/meeting.mp3');
      await waitMs(2000);
      await playerActionsRef.current.playSound('/sounds/sussy-boy.mp3');
    });
    socket.on('meeting-started', () => setMeeting(true));
    socket.on('meeting-ended', () => setMeeting(false));
    socket.on('game-started', () => {
      playerActionsRef.current.stopAllSounds();
      setHasUsedSabotage(false);
      setSabotageEndMs(0);
      setGameWinner(null);
      setIsDead(false);
      setGameActive(true);
    });
    socket.on('game-ended', () => {
      playerActionsRef.current.stopAllSounds();
      setHasUsedSabotage(false);
      setSabotageEndMs(0);
      setSabotageChargesRemaining(0);
      setGameActive(false);
      setIsDead(false);
      setMeeting(false);
      setTasks({});
      setProgress(0);
    });
    socket.on('state', (s) => {
      setMeeting(!!s?.isMeeting);
      setGameActive(!!s?.isGameActive);
      setGameWinner(['crewmates', 'impostors'].includes(s?.gameWinner) ? s.gameWinner : null);
      setMapUrl(typeof s?.mapUrl === 'string' ? s.mapUrl : '');
      if (typeof s?.sabotageChargesRemaining === 'number') setSabotageChargesRemaining(s.sabotageChargesRemaining);
    });
    socket.on('player-dead', () => setIsDead(true));
    socket.on('sabotage-started', ({ endMs }) => {
      setSabotageEndMs(endMs || 0);
      playerActionsRef.current.playLoop('/sounds/sabotage.mp3', endMs);
    });
    socket.on('sabotage-ended', () => {
      setSabotageEndMs(0);
      playerActionsRef.current.stopLoop();
    });
    socket.on('sabotage-charges', ({ remaining }) => {
      setSabotageChargesRemaining(remaining || 0);
    });
    socket.on('sabotage-usage', ({ used }) => {
      setHasUsedSabotage(!!used);
    });
    socket.on('kill-cooldown-updated', ({ endMs }) => {
      const remaining = endMs - Date.now();
      setKillCooldownRemainingMs(Math.max(0, remaining));
    });
    socket.on('game-won', async (result) => {
      if (!['crewmates', 'impostors'].includes(result?.winner)) return;
      setGameWinner(result.winner);
      await playerActionsRef.current.playSound('/sounds/you-win.mp3');
      if ('Notification' in window && Notification.permission === 'granted' &&
          !pushReadyRef.current &&
          document.visibilityState === 'visible') {
        const winnerName = result.winner === 'crewmates' ? 'Crewmates' : 'Impostors';
        new Notification(`${winnerName} win!`, {
          body: result.body || 'The game has finished.',
          tag: 'among-us-game-won',
          icon: '/images/emergency-meeting.jpg'
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [playerName, loginAttempt]);

  async function syncPushSubscription(socket, publicKey, requestPermission = false) {
    try {
      if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('Push notifications require HTTPS and a supported browser.');
      }
      let permission = Notification.permission;
      if (permission === 'default' && requestPermission) {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked in your browser settings.'
          : 'Allow notifications to receive meeting alerts.');
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey)
        });
      }
      const response = await new Promise((resolve, reject) => {
        socket.timeout(10000).emit('save-push-subscription', { subscription: subscription.toJSON() }, (error, result) => {
          if (error) reject(new Error('The server did not save your notification settings.'));
          else if (!result?.ok) reject(new Error(result?.reason === 'persistence-unavailable'
            ? 'The server could not save your notification settings.'
            : 'The server could not enable notifications.'));
          else resolve(result);
        });
      });
      setPushSubscriptionSaved(true);
      setPushMessage(response.ok ? 'Meeting notifications are enabled on this device.' : '');
    } catch (error) {
      console.error('Could not enable push notifications:', error);
      setPushSubscriptionSaved(false);
      setPushMessage(error.message || 'Could not enable notifications.');
    }
  }

  function loginWithName(event) {
    event.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      setLoginError('Enter your name to join.');
      return;
    }
    setLoginError('');
    try {
      localStorage.setItem('playerJoinCode', playerCode);
    } catch {
      console.warn('Could not save the player access code in browser storage.');
    }
    setPlayerName(name);
    setLoginAttempt((attempt) => attempt + 1);
  }

  function toggleTask(taskId, checked) {
    const socket = socketRef.current;
    if (!socket) return;
    if (isImpostor) {
      // Local-only toggle for impostors (UI tracking, no server emit)
      setCompleted((prev) => {
        const next = { ...prev, [taskId]: !!checked };
        try {
          const key = `imp_completed_${authId || 'unknown'}`;
          const current = JSON.parse(localStorage.getItem(key) || '{}');
          current[taskId] = !!checked;
          localStorage.setItem(key, JSON.stringify(current));
        } catch (error) {
          console.warn('Could not persist impostor task progress.', error);
        }
        return next;
      });
      return;
    }
    socket.emit(checked ? 'task-complete' : 'task-incomplete', taskId);
  }

  async function waitMs(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async function playSound(url) {
    const el = audioRef.current;
    if (!el) return;
    // Ensure audio is user-unlocked on mobile before attempting playback
    if (!audioReady) {
      try {
        await enableAudio();
      } catch (error) {
        console.warn('Audio could not be unlocked yet.', error);
      }
    }
    el.src = url;
    try {
      await el.play();
    } catch (error) {
      console.warn('Audio playback was blocked by the browser.', error);
    }
  }

  // Simple loop helper for sabotage alarm
  const loopRef = useRef(null);
  async function playLoop(url, endMs) {
    stopLoop();
    const el = audioRef.current;
    if (!el) return;
    if (!audioReady) {
      try {
        await enableAudio();
      } catch (error) {
        console.warn('Could not unlock audio for the sabotage alarm.', error);
      }
    }
    const tick = async () => {
      if (Date.now() >= (endMs || 0)) { stopLoop(); return; }
      try {
        el.src = url;
        await el.play();
      } catch (error) {
        console.warn('Sabotage alarm playback failed.', error);
      }
      loopRef.current = setTimeout(tick, (el.duration && !isNaN(el.duration) ? el.duration * 1000 : 1500));
    };
    tick();
  }
  function stopLoop() {
    if (loopRef.current) { clearTimeout(loopRef.current); loopRef.current = null; }
    const el = audioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
  }

  function stopAllSounds() {
    stopLoop();
    const el = audioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
  }

  async function enableAudio() {
    const el = audioRef.current;
    if (!el) return;
    try {
      // Try to unlock by playing a short muted sound on a user gesture
      el.muted = true;
      el.playsInline = true;
      el.src = '/sounds/start.mp3';
      await el.play();
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      setAudioReady(true);
    } catch (error) {
      console.warn('Audio remains locked; tap the screen to enable playback.', error);
    }
  }

  // Players report by clicking the report image, not via keyboard

  const disableTasks = meeting || !gameActive || isDead;
  useEffect(() => {
    const i = setInterval(() => {
      setKillCooldownRemainingMs((prev) => {
        const next = prev - 1000;
        return next > 0 ? next : 0;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Add a one-time user-gesture handler to unlock audio on mobile
  useEffect(() => {
    function onFirstInteract() {
      if (!audioReady) {
        enableAudio();
      }
      window.removeEventListener('pointerdown', onFirstInteract);
      window.removeEventListener('touchend', onFirstInteract);
      window.removeEventListener('click', onFirstInteract);
    }
    window.addEventListener('pointerdown', onFirstInteract, { passive: true });
    window.addEventListener('touchend', onFirstInteract, { passive: true });
    window.addEventListener('click', onFirstInteract, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstInteract);
      window.removeEventListener('touchend', onFirstInteract);
      window.removeEventListener('click', onFirstInteract);
    };
  }, [audioReady]);

  // Hydrate impostor local completion and merge on top of server map
  useEffect(() => {
    if (!authId || !isImpostor) return;
    try {
      const key = `imp_completed_${authId}`;
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      setCompleted((previous) => {
        const merged = { ...previous };
        for (const tid of Object.keys(tasks || {})) {
          if (typeof stored[tid] === 'boolean') merged[tid] = stored[tid];
        }
        return merged;
      });
    } catch (error) {
      console.warn('Could not restore impostor task progress.', error);
    }
  }, [authId, isImpostor, tasks]);

  // Stopwatch ticker
  useEffect(() => {
    if (!stopwatchRunning) return;
    swLastTickRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = now - swLastTickRef.current;
      swLastTickRef.current = now;
      setStopwatchMs((prev) => prev + delta);
    }, 250);
    return () => clearInterval(id);
  }, [stopwatchRunning]);

  function toggleStopwatch() {
    setStopwatchRunning((r) => !r);
  }
  function resetStopwatch() {
    setStopwatchMs(0);
    setStopwatchRunning(false);
  }
  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  playerActionsRef.current = { playLoop, playSound, stopAllSounds, stopLoop };

  const hasTasks = Object.keys(tasks).length > 0;
  const [hasUsedSabotage, setHasUsedSabotage] = useState(false);
  const playerIdentity = (
    <Typography variant="subtitle2" color="text.secondary" sx={{ alignSelf: 'flex-start', px: 0.5, lineHeight: 1.2 }}>
      {playerName}
    </Typography>
  );

  if (!playerName || loginError) {
    return (
      <Stack component="form" spacing={1.5} alignItems="center" onSubmit={loginWithName} sx={{ width: '100%', py: 1 }}>
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5" align="center">Join the game</Typography>
              <Typography align="center">Enter your name so the admin can see when you are connected.</Typography>
              {loginError && <Alert severity="error">{loginError}</Alert>}
              <TextField
                autoFocus
                label="Your name"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                inputProps={{ maxLength: 32 }}
                required
                fullWidth
              />
              {playerCodeRequired && (
                <TextField
                  label="Player access code"
                  type="password"
                  value={playerCode}
                  onChange={(event) => setPlayerCode(event.target.value)}
                  required
                  fullWidth
                />
              )}
              <Button type="submit" variant="contained">Connect</Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  if (!gameActive) {
    return (
      <Stack spacing={1} alignItems="center" sx={{ width: '100%' }}>
        {playerIdentity}
        {!isConnected && <Alert severity="warning">Connection lost. Reconnecting…</Alert>}
        {isConnected && pushMessage && <Alert severity={pushEnabled && Notification.permission === 'granted' ? 'success' : 'info'}>{pushMessage}</Alert>}
        {isConnected && pushEnabled && !pushSubscriptionSaved && (
          <Button variant="outlined" onClick={() => syncPushSubscription(socketRef.current, pushPublicKey, true)}>
            Enable meeting notifications
          </Button>
        )}
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent>
            <Typography variant="h5" align="center">{gameWinner ? 'GAME OVER' : 'GAME NOT STARTED'}</Typography>
            {gameWinner && (
              <Typography align="center">
                {gameWinner === 'crewmates' ? 'Crewmates' : 'Impostors'} win!
              </Typography>
            )}
          </CardContent>
        </Card>
        <Tooltip title="Open Map">
          <IconButton color="primary" onClick={() => setMapOpen(true)}>
            <MapIcon />
          </IconButton>
        </Tooltip>
        <Dialog open={mapOpen} onClose={() => setMapOpen(false)} maxWidth="lg">
          <DialogContent sx={{ p: 0 }}>
            <Box component="img" src={mapUrl || '/images/MAP.JPG'} alt="Map" sx={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block' }} />
          </DialogContent>
        </Dialog>
        <WinnerSnackbar winner={gameWinner} onClose={() => setGameWinner(null)} />
      </Stack>
    );
  }

  if (gameActive && !hasTasks) {
    return (
      <Stack spacing={1} alignItems="center" sx={{ width: '100%' }}>
        {playerIdentity}
        {!isConnected && <Alert severity="warning">Connection lost. Reconnecting…</Alert>}
        {isConnected && pushMessage && <Alert severity={pushEnabled && Notification.permission === 'granted' ? 'success' : 'info'}>{pushMessage}</Alert>}
        {isConnected && pushEnabled && !pushSubscriptionSaved && (
          <Button variant="outlined" onClick={() => syncPushSubscription(socketRef.current, pushPublicKey, true)}>
            Enable meeting notifications
          </Button>
        )}
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent>
            <Typography variant="h5" align="center">A GAME IS IN PROGRESS</Typography>
            <Typography align="center">Please wait until the next round to join.</Typography>
          </CardContent>
        </Card>
        <WinnerSnackbar winner={gameWinner} onClose={() => setGameWinner(null)} />
      </Stack>
    );
  }

  return (
    <Stack spacing={1} alignItems="center" sx={{ width: '100%' }}>
      {playerIdentity}
      {!isConnected && <Alert severity="warning">Connection lost. Reconnecting…</Alert>}
      {isConnected && pushMessage && <Alert severity={pushEnabled && Notification.permission === 'granted' ? 'success' : 'info'}>{pushMessage}</Alert>}
      {isConnected && pushEnabled && !pushSubscriptionSaved && (
        <Button variant="outlined" onClick={() => syncPushSubscription(socketRef.current, pushPublicKey, true)}>
          Enable meeting notifications
        </Button>
      )}
      {/* Stopwatch */}
      <Stack spacing={1} direction="row" alignItems="center">
        <Typography variant="h6" sx={{ minWidth: 72, textAlign: 'center' }}>{formatTime(stopwatchMs)}</Typography>
        <Button size="small" variant="outlined" onClick={toggleStopwatch}>{stopwatchRunning ? 'Pause' : 'Start'}</Button>
        <Button size="small" variant="text" onClick={resetStopwatch} disabled={stopwatchMs === 0}>Reset</Button>
      </Stack>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
        <Box component="img" src="/images/report.png" alt="Report" sx={{ width: 140, cursor: isDead ? 'not-allowed' : 'pointer', opacity: isDead ? 0.5 : 1, borderRadius: 1 }} onClick={() => { if (!isDead) socketRef.current?.emit('report'); }} />
        {isImpostor && (
          <Box sx={{ position: 'relative', width: 140 }}>
            <Box component="img" src={killCooldownRemainingMs > 0 ? '/images/kill-cooldown.png' : '/images/kill.png'} alt="Kill" sx={{ width: '100%', cursor: killCooldownRemainingMs > 0 ? 'not-allowed' : 'pointer', borderRadius: 1 }} onClick={() => { if (killCooldownRemainingMs <= 0) socketRef.current?.emit('kill'); }} />
            {killCooldownRemainingMs > 0 && (
              <Box sx={{ position: 'absolute', bottom: 6, right: 6, bgcolor: 'rgba(0,0,0,0.85)', color: '#fff', px: 1, py: 0.25, borderRadius: '12px', fontSize: 14, fontWeight: 700 }}>
                {Math.ceil(killCooldownRemainingMs / 1000)}s
              </Box>
            )}
          </Box>
        )}
        <Tooltip title="Open Map">
          <IconButton color="primary" onClick={() => setMapOpen(true)}>
            <MapIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {isImpostor && (
        <Stack spacing={1} alignItems="center">
          <Button variant="contained" color="error" disabled={!gameActive || meeting || isSabotageActive || hasUsedSabotage || sabotageChargesRemaining <= 0} onClick={() => socketRef.current?.emit('sabotage')}>
            Sabotage
          </Button>
          <Typography variant="caption" color={sabotageChargesRemaining > 0 ? 'text.secondary' : 'error'}>
            Sabotage charges: {sabotageChargesRemaining}
          </Typography>
        </Stack>
      )}

      {role ? (
        <Alert severity="info">
          You are {role === 'Impostor' ? 'an' : 'a'} {role}.
        </Alert>
      ) : null}
      {isDead && <Alert severity="warning">You are eliminated and can no longer complete tasks.</Alert>}
      {gameActive && role === 'Crewmate' && !isDead && (
        <Button
          variant="outlined"
          color="error"
          onClick={() => {
            if (window.confirm('Confirm that you have been eliminated?')) {
              socketRef.current?.emit('mark-dead');
            }
          }}
        >
          Mark me as eliminated
        </Button>
      )}

      <Card sx={{ width: '100%', maxWidth: 420, textAlign: 'left' }}>
        <CardContent>
          <Typography gutterBottom>Progress</Typography>
          <Box display="flex" alignItems="center" gap={2}>
            <Box flexGrow={1}>
              <LinearProgress variant="determinate" value={progress * 100} />
            </Box>
            <Typography variant="body2">{(progress * 100).toFixed(0)}%</Typography>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ width: '100%', maxWidth: 420, textAlign: 'left' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tasks</Typography>
          <List>
            {Object.entries(tasks).map(([taskId, label]) => (
              <ListItem key={taskId} disableGutters>
                <FormControlLabel control={<Checkbox disabled={disableTasks} checked={!!completed[taskId]} onChange={(e) => toggleTask(taskId, e.target.checked)} />} label={<ListItemText primary={label} />} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

      <audio ref={audioRef} preload="auto" playsInline />

      <Backdrop open={meeting} sx={{ color: '#fff', zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Typography variant="h4" align="center">COME BACK FOR A MEETING</Typography>
      </Backdrop>

      <Dialog open={mapOpen} onClose={() => setMapOpen(false)} maxWidth="lg">
        <DialogContent sx={{ p: 0 }}>
          <Box component="img" src={mapUrl || '/images/MAP.JPG'} alt="Map" sx={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block' }} />
        </DialogContent>
      </Dialog>
      <WinnerSnackbar winner={gameWinner} onClose={() => setGameWinner(null)} />
    </Stack>
  );
}
