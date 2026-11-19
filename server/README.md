# Stölk server

The local API behind the Stölk desktop app. It keeps your data in one SQLite file on your own computer and serves it over HTTP on `127.0.0.1` only, behind a bearer token.

- No runtime dependencies: `node:http`, `node:sqlite`, `node:crypto`. Needs Node ≥ 22.13 (or Electron ≥ 36).
- Data: `~/.stolk/stolk.db`. Keys: `~/.stolk/.env` (mode 600, never in the repo).
- Full interface: see `/mnt/project-files/plan/stolk-api-interface.md` in the project (copied in `docs/api.md` when it settles).

## Run

```bash
cd server
npm ci
npm run build
npm run seed     # optional: the prototype's example data, only into an empty DB
npm start        # prints {"ready":true,"port":N,"token":"…"} when no STOLK_TOKEN is set
```

Then:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/contacts
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `STOLK_TOKEN` | random | Bearer token. Electron main sets it. |
| `STOLK_PORT` | `0` (random) | Port on 127.0.0.1. |
| `STOLK_HOME` | `~/.stolk` | Folder for the DB and `.env`. |
| `STOLK_DB` | `$STOLK_HOME/stolk.db` | SQLite file. |
| `STOLK_EXIT_ON_STDIN_CLOSE` | unset | `1` makes the server exit when its parent closes stdin. |

## From Electron

```js
const child = spawn(process.execPath, [serverMain], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', STOLK_TOKEN: token, STOLK_EXIT_ON_STDIN_CLOSE: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
// Read the first stdout line: {"ready":true,"port":N}
```

The renderer may call it directly from `file://` (it sends `Origin: null`, which is allowed). Any other Origin gets 403.

## Package

`npm run build` writes `dist/`, which is self-contained (it has its own `package.json` with `"type":"module"`). Copy that folder into the app, for example with electron-builder `extraResources`.

## Test

```bash
npm test         # builds and runs test/*.test.ts against a temp DB
```

## Status

| Area | State |
|---|---|
| Contacts, dedupe match, interactions, relations | Done |
| Events with guests, URL, likely guests | Done |
| Projects, people, tasks with status | Done |
| Today, calendar (from local data) | Done |
| Settings, connections (keys to `.env`) | Done |
| Cal.com and Google sync, Cal.com blocking | Next (`POST /sync` returns 501) |
| Preguntar with Claude | After that (`POST /ask` returns 501) |
