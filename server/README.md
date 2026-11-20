# Stölk server

The local API behind the Stölk desktop app. It keeps your data in one SQLite file on your own computer and serves it over HTTP on `127.0.0.1` only, behind a bearer token.

- Built on `node:http` and `node:sqlite`, plus the Anthropic SDK for Preguntar. The build bundles everything into `dist/`, so it runs without `node_modules`. Needs Node ≥ 22.13 (or Electron ≥ 36).
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

`npm run build` type-checks and then bundles with esbuild into `dist/` (about 6 MB). That folder runs on its own: it has its own `package.json` with `"type":"module"` and needs no `node_modules`. Copy that folder into the app, for example with electron-builder `extraResources`.

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
| Cal.com sync and blocking your Stölk events | Done |
| Google Calendar and Gmail (headers only) sync | Done |
| Logging chat-button clicks (WhatsApp, Telegram, Gmail, LinkedIn) | Done |
| Preguntar with Claude (answers, sources, message drafts) | Done |

## Connecting your accounts

Keys never go in the repo or the chat. Paste them in Stölk → Ajustes, which writes `~/.stolk/.env`.

**Cal.com.** Cal.com → Settings → Developer → API keys → create a key. Paste it in Ajustes. On the first sync Stölk creates a hidden event type, "Bloqueado (Stölk)" (`bloqueado-stolk`). Every upcoming Stölk event with a time gets booked on it, so nobody can book you over your own events. Moving or deleting the event moves or cancels the block.

**Google Calendar and Gmail** (read-only: calendar events, and email headers such as sender and subject, never the body):
1. Go to https://console.cloud.google.com/, create a project, and enable the **Google Calendar API** and the **Gmail API**.
2. Under **Google Auth Platform → Audience**, choose External and add yourself as a test user.
3. Under **Data access**, add the scopes `calendar.readonly` and `gmail.metadata`.
4. Under **Clients**, create a client of type **Desktop app**. Copy its client ID and secret.
5. In Stölk → Ajustes → Google, paste both and press Conectar. Your browser opens Google, and after you accept it comes back to `127.0.0.1` and closes the loop.

While the Google project is in "Testing", Google expires the sign-in after 7 days, so you reconnect weekly. Publishing the app for your own use removes that.

**What gets synced** (`POST /sync`, or automatically after connecting Google):
- Cal.com: bookings from 90 days back to 120 days ahead. Past meetings with a known contact (matched by email) are added to their history once.
- Google Calendar: events on your primary calendar in the same window. Slots that duplicate a Cal.com booking are skipped.
- Gmail: each email to or from a known contact becomes one history entry ("Te escribió: subject" or "Le escribiste: subject").
- WhatsApp and Telegram: there is no allowed way to read personal chats, so Stölk logs when you open a chat from a person's card (`POST /contacts/:id/opened`).

## Preguntar

`POST /ask {question}` sends the question to Claude together with a compact JSON copy of your data: contacts (no phone numbers), the last year of history, relations, events, projects, bookings, and the next 90 days of Google Calendar. It returns `{answer, offTopic, emotion, cites, draft, used, model}`. Preguntar sticks to Stölk: off-topic asks (code, homework, general knowledge) get a short refusal with `offTopic: true` and `emotion: "angry"`. It allows 6 questions a minute and 200 a day (429 `ask_rate_limited` / `ask_daily_limit`), and answers are capped at 2,500 characters. When you ask it to write to someone, `draft` is `{cid, text}`, and the app shows it next to the send buttons. Nothing is ever sent automatically.

It works as a chat. Send the earlier turns as `history: [{role: "user"|"assistant", text}]` (up to 20) and files as `attachments: [{name, mediaType, data}]` with `data` in base64. Photos (PNG, JPG, WebP, GIF), PDFs and text files (TXT, MD, CSV) are accepted, up to 5 files and 10 MB in total. Anything else gets a 400 with a message in Spanish.

- Model: `claude-opus-5-5` by default, changeable in Ajustes (`claudeModel`: Opus 5.5, Sonnet 5.5 or Haiku 5.5).
- It uses structured output, so the reply is always valid JSON. Server-side fallbacks are on, so if the model declines a question, another model answers instead.
- The data block is prompt-cached, so follow-up questions within a few minutes are cheaper.
- Turn it off with `claudeOn: false` in Ajustes.

## Buscar info pública

This is for personal use, on one person at a time, and it's off until `enrichOn: true` (Ajustes → Claude). `POST /contacts/:id/enrich` asks Claude, with web search (up to 5 searches), for that person's public professional info: current role, company, company site, public profile URL and recent news. Every fact comes with its source. The results are saved in `enrichments` as suggestions, and the contact only changes through `POST /contacts/:id/enrichment/apply {fields}`. Claude gets only the name, role, company, web, LinkedIn and a work email domain. It never gets phone numbers, notes or the full email. Facts whose source didn't appear in the search results are dropped. The response includes `searches` and an approximate `costUsd`, typically 0.10 to 0.30 $ with Opus 5.5.

## Claude ("pásalo a Stölk")

`dist/mcp.js` is an MCP server on stdio. Claude desktop or Claude Code start it, and it opens the same `~/.stolk/stolk.db` as the app, so when Ivan tells Claude "pásalo a Stölk", the people, conversations and tasks land here. It goes through the same routes as the HTTP API (in process, no token or port needed).

Tools: `search_contacts`, `get_contact`, `add_contact` (refuses a likely duplicate and returns the matches), `update_contact` (`addNote`, `addTags`), `log_interaction`, `add_task` (into a project by name, created on demand, default "Pendientes"), `list_tasks`, `complete_task`, `list_projects`, `add_project`. Nothing deletes. There is also a `pasar_a_stolk` prompt.

Ajustes → "Pasar a Stölk desde Claude" calls:

- `GET /integrations/claude` → `{ desktop: {available, connected, config}, code: {...}, launcher, installed }`
- `POST /integrations/claude/desktop|code` adds `mcpServers.stolk` to `~/.config/Claude/claude_desktop_config.json`, or to Claude Code's user config (`claude mcp add --scope user` when the CLI is on PATH, else `~/.claude.json`). Other settings in those files are kept, and an unreadable file is never overwritten.
- `DELETE /integrations/claude/desktop|code` removes it.

Both point at `~/.stolk/bin/stolk-mcp`, a launcher the server rewrites at every start. It runs `~/.stolk/mcp/stolk-mcp.js` (a copy of `dist/mcp.js`) with the current AppImage or Electron binary and `ELECTRON_RUN_AS_NODE=1`, so updates that rename the AppImage need no reconnect.

Try it by hand: `npm run build && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | STOLK_HOME=/tmp/stolk-try node dist/mcp.js`
