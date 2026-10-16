# Among Us in real life

I hacked together this small little web app for facilitating a game of Among Us in real life.

## Features

-   Assign impostors/crewmates
-   Assign tasks
-   Checking off tasks updates a global progress bar in real-time
-   Automatically announce crew task victories and impostor parity victories

Audio recordings from [https://www.voicy.network/pages/among-us](https://www.voicy.network/pages/among-us)

## Screenshot

<img src="media/IMG_0976.PNG" width="50%" />

## Usage

This was built for personal use, but anyone is welcome to use this for hosting their own game.

### 1. Configure the game

Manage game settings and task collections from the admin dashboard. Each collection can be used for a different location; task labels are assigned without duplicates for an individual player, and the per-task player cap is respected when the task pool allows it.

Edit each collection's tasks and rooms inline in the admin table. The **Unsaved changes** indicator appears while edits are pending; use **Save task changes** above the table or **Save changes** below it to persist them. Starting a game also saves the collection first. Collections can also have their own JPG, PNG, or WebP map (up to 10 MB), saved alongside persistent server data and shown to players during that collection's game. The admin dashboard shows global task completion across all players.

Players join by entering a name. Names are case-insensitive and must be unique while connected; the admin dashboard shows all players who have logged in and whether each is currently connected. Admins can remove saved players from the roster when a game is not active; removing a connected player also disconnects them. The roster, game settings, roles, task progress, and active round are saved in `DATA_DIR` (defaults to `data/`) and restored after a backend restart. Keep this directory on persistent storage when deploying; the provided Compose configuration mounts a named volume for it.

Crewmates win when every assigned crew task is complete. Tasks belonging to a dead crewmate are automatically completed one at a time after the configured **Dead Player Task Interval**, which defaults to 90 seconds and can be changed in the admin game settings. Impostors win when the number of living impostors equals or exceeds the living crewmates; because eliminations are confirmed by players in this real-life game, a crewmate should use **Mark me as eliminated** after being eliminated. Either faction victory plays the win sound and shows a popup; opted-in push subscribers also receive a notification when their browser is in the background. The admin can then end the round before starting another.

Impostors can activate sabotage using an available charge. The configured **Sabotage Duration** (60 seconds by default) starts a visible countdown and notification for all players. Any two different living players can press **Defuse sabotage**; if the timer expires first, the impostors win immediately. A successful defuse also sends a notification. The duration and shared sabotage charges can be changed in the admin game settings.

### 2. Deploy with Docker Compose

The Compose setup builds the frontend and backend, keeps game data in a named volume, waits for the backend health check, and restarts crashed containers.

```sh
cp .env.example .env
```

Set a strong, private `ADMIN_CODE` in the **repository-root** `.env` file. The admin code is a server setting, not a Vite/frontend setting: do not put it in `web/.env` or name it `VITE_ADMIN_CODE`. Direct `npm start` and Docker Compose both load the root `.env`; Compose refuses to start if `ADMIN_CODE` is missing.

Player access is protected by a randomly generated six-character code by default. The backend creates it once when no code is present in the persisted state, keeps it until the saved state is deleted or replaced, and shows it prominently in the authenticated admin panel. Players must enter this code before joining with their name. It is separate from `ADMIN_CODE`. To deliberately disable the player-code requirement, set `PLAYER_AUTH_REQUIRED=false`.

For background meeting and game-win notifications, generate a VAPID key pair with `npx web-push generate-vapid-keys` and set both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the root `.env`; leave both empty to disable push notifications. Set `PUSH_SUBJECT` to a contact email or an HTTPS URL. Keep the private key and `.env` out of source control.

```sh
docker compose up --build -d
docker compose logs -f
```

The app listens on `127.0.0.1:8080` by default. Point your existing reverse proxy only at the `frontend` service; Caddy forwards `/api`, `/socket.io`, and `/healthz` internally to the backend. Terminate TLS at your reverse proxy and enable WebSocket upgrades for `/socket.io/`. The browser-facing site must use HTTPS for push notifications and is strongly recommended for normal use. If the reverse proxy is in another container, set `APP_BIND_ADDRESS=0.0.0.0` or attach it to the Compose network and proxy to the `frontend` service. Optionally set `CORS_ORIGIN` to your public origin (for example, `https://among.example.com`).

Back up the `game-data` Docker volume, which contains both `game-state.json` and uploaded collection maps. A container restart preserves it; deleting the volume does not. To restore, stop the app, restore the volume backup, then start the app. Do not run multiple backend replicas with this file-based storage, because each replica would have independent state.

Hosting platforms with ephemeral disks (including free Render services) will lose saved game state on redeploy or restart unless you attach persistent storage and set `DATA_DIR` to its mount path.

### Automatic container images

The GitHub Actions workflow `.github/workflows/container-images.yml` runs the tests and publishes both images to GitHub Container Registry after every push to `master`:

```text
ghcr.io/lukwdev/among-us-real-life-backend:latest
ghcr.io/lukwdev/among-us-real-life-frontend:latest
```

On the server, clone the repository once, create the root `.env`, and update the deployment after a successful workflow run:

```sh
docker login ghcr.io
docker compose pull
docker compose up -d
docker compose logs -f
```

Use a GitHub token with **read:packages** permission for `docker login` if the images are private. Keep the token out of `.env` and source control. The Compose file still contains both Docker build definitions, so `docker compose up --build -d` remains available for local builds. To deploy a specific immutable build instead of `latest`, set `BACKEND_IMAGE` and `FRONTEND_IMAGE` in `.env` to the matching `:sha-<commit>` image tags.

### Backend structure

- `src/index.js` wires configuration, HTTP, Socket.IO, and game lifecycle events.
- `src/json-store.js` handles JSON reads and atomic writes for durable game state.
- `src/collection-map-router.js` validates, persists, and serves collection map uploads.
- `src/push-notifications.js` sends meeting and game-win alerts and prunes expired subscriptions.
- `src/game-progress.js` calculates and broadcasts global task progress.
- `src/game-outcome.js` determines whether impostors have reached parity with the living crew.

### 3. Run locally without Docker

Use Node.js 24 LTS. Copy `.env.example` to `.env` in the repository root, then set `ADMIN_CODE`. For development, run `npm run dev`; Vite serves the frontend with hot reload, and Node automatically restarts the backend when server files change. You do not need to build the frontend while developing. Start the production build with:

```
$ npm ci
$ npm ci --prefix web
$ npm run build:web
$ npm start
```

The production server serves the built React app at `/`, `/admin`, and `/gamemaster`.

### 4. Connect to the admin dashboard

Visit `/admin` on your deployed site and enter the `ADMIN_CODE` configured on the server. The code is verified by the backend; it is not compiled into the frontend. For live supervision during a round, use `/gamemaster`: it groups players by the room of their most recently completed task, includes impostor fake-task activity, and shows a live event log. This view uses the same authenticated admin session.

Pressing the start button will reset task progress, assign new tasks, and assign impostors. Press it once all players connect, otherwise you will have to press it again.

### 5. Invite friends to join

Players open the site on their phones and sign in with their name. They can opt in to meeting push notifications from the player screen. Push notifications are sent directly from this server using standard Web Push; Firebase is not required. Browser support varies, and iPhone/iPad users generally need to add the HTTPS site to their Home Screen before enabling web push. Notification delivery also depends on the browser and operating system.

The existing in-page sounds alone do not cover a screen that is locked or a browser suspended in the background. A service worker and Web Push can alert players in that situation once they have opted in, but a web app cannot guarantee delivery if notifications are blocked, the device is offline, or the OS suppresses them.

## Operational limits

- Persistent state is stored in a single JSON file and supports one backend instance only. Keep `DATA_DIR` on persistent storage and maintain external backups.
- Browser and operating-system lifecycle behavior varies. Push alerts require HTTPS, user permission, and working browser/OS push support; delivery cannot be guaranteed when a device is offline or notifications are suppressed.
- Run `npm test` to execute the backend unit tests and `npm run lint --prefix web` to check the frontend.
