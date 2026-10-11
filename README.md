# Among Us in real life

I hacked together this small little web app for facilitating a game of Among Us in real life.

## Features

-   Assign impostors/crewmates
-   Assign tasks
-   Checking off tasks updates a global progress bar in real-time

Audio recordings from [https://www.voicy.network/pages/among-us](https://www.voicy.network/pages/among-us)

## Screenshot

<img src="media/IMG_0976.PNG" width="50%" />

## Usage

This was built for personal use, but anyone is welcome to use this for hosting their own game.

### 1. Configure the game

You may want to modify the following properties located in [`src/index.js`](https://github.com/michaelgira23/among-us-real-life/blob/master/src/index.js):

[`TASKS`](https://github.com/michaelgira23/among-us-real-life/blob/master/src/index.js#L14) - An array of strings that consist of all possible tasks. These will be randomly assigned to players.

[`N_TASKS`](https://github.com/michaelgira23/among-us-real-life/blob/master/src/index.js#L31) - Default number of tasks to assign each player

[`N_IMPOSTORS`](https://github.com/michaelgira23/among-us-real-life/blob/master/src/index.js#L32) - Number of impostors to assign each round

You can also change the task count from the admin dashboard before starting a round. The assignment logic now keeps every player’s task list unique and prevents one task label from exceeding the configured per-task cap.

Players join by entering a name. Names are case-insensitive and must be unique while connected; the admin dashboard shows all players who have logged in and whether each is currently connected. Admins can remove saved players from the roster when a game is not active; removing a connected player also disconnects them. The roster, game settings, roles, task progress, and active round are saved in `DATA_DIR` (defaults to `data/`) and restored after a backend restart. Keep this directory on persistent storage when deploying; the provided Compose configuration mounts a named volume for it.

### 2. Deploy with Docker Compose

The Compose setup builds the frontend and backend, keeps game data in a named volume, waits for the backend health check, and restarts crashed containers.

```sh
cp .env.example .env
```

Set a strong, private `ADMIN_CODE` in the **repository-root** `.env` file. The admin code is a server setting, not a Vite/frontend setting: do not put it in `web/.env` or name it `VITE_ADMIN_CODE`. Direct `npm start` and Docker Compose both load the root `.env`; Compose refuses to start if `ADMIN_CODE` is missing.

For background meeting notifications, generate a VAPID key pair with `npx web-push generate-vapid-keys` and set both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the root `.env`; leave both empty to disable push notifications. Set `PUSH_SUBJECT` to a contact email or an HTTPS URL. Keep the private key and `.env` out of source control.

```sh
docker compose up --build -d
docker compose logs -f
```

The app listens on `127.0.0.1:8080` by default. Point your existing reverse proxy at that address, terminate TLS there, and enable WebSocket upgrades for `/socket.io/`. The browser-facing site must use HTTPS for push notifications and is strongly recommended for normal use. If the reverse proxy is in another container, set `APP_BIND_ADDRESS=0.0.0.0` or attach it to the Compose network and proxy to the `frontend` service. Optionally set `CORS_ORIGIN` to your public origin (for example, `https://among.example.com`).

Back up the `game-data` Docker volume. A container restart preserves it; deleting the volume does not. Do not run multiple backend replicas with this file-based storage, because each replica would have independent state.

Hosting platforms with ephemeral disks (including free Render services) will lose saved game state on redeploy or restart unless you attach persistent storage and set `DATA_DIR` to its mount path.

### 3. Run locally without Docker

Copy `.env.example` to `.env` in the repository root, then set `ADMIN_CODE`. Start the app with:

```
$ npm ci
$ npm ci --prefix web
$ npm run build:web
$ npm start
```

The production server serves the built React app at `/` and `/admin`. During development, run `npm run dev`; Vite proxies game sockets and media to the backend.

### 4. Connect to the admin dashboard

Visit `/admin` on your deployed site and enter the `ADMIN_CODE` configured on the server. The code is verified by the backend; it is not compiled into the frontend.

Pressing the start button will reset task progress, assign new tasks, and assign impostors. Press it once all players connect, otherwise you will have to press it again.

### 5. Invite friends to join

Players open the site on their phones and sign in with their name. They can opt in to meeting push notifications from the player screen. Push notifications are sent directly from this server using standard Web Push; Firebase is not required. Browser support varies, and iPhone/iPad users generally need to add the HTTPS site to their Home Screen before enabling web push. Notification delivery also depends on the browser and operating system.

The existing in-page sounds alone do not cover a screen that is locked or a browser suspended in the background. A service worker and Web Push can alert players in that situation once they have opted in, but a web app cannot guarantee delivery if notifications are blocked, the device is offline, or the OS suppresses them.

## Known issues

-   Sometimes, duplicate tasks are assigned (temporary workaround is to start another game)
-   On some Android phones, hiding the browser will reset its state, therefore losing your tasks
