# Stölk (personal, on-device)

Remember everyone you meet. You log who you met, and the phone's GPS tags where. Later you ask "who did I meet at South Summit?" and a small language model answers **on the phone**. There is no server, no cloud AI and no account. The only network use is the one-time model download.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Expo SDK 57 (React Native 0.86) + TypeScript + expo-router**, as a development build (not Expo Go) | One codebase for Android and iPhone. Native modules are needed for SQLite and llama.cpp. |
| Default target | **Android** | You can keep a personal build installed without a paid Apple account. On iOS a free account needs a re-sign every 7 days. `npm run ios` still works. |
| Database | **op-sqlite** with **FTS5** + **sqlite-vec** | One local file holds tables, keyword search and vector search together. |
| Local LLM | **llama.rn** (llama.cpp) running **Qwen3 1.7B Q4_K_M** (~1.1 GB) | Fast enough on a mid-range phone. JSON-schema-constrained output makes a small model reliable at extracting filters. Any GGUF model can be swapped in via `src/ai/models.ts`. |
| Embeddings | **nomic-embed-text v1.5 Q8_0** (~140 MB, 768-d) via llama.rn | Runs on-device and feeds the `chunk_vec` index. |
| Location | **expo-location** (GPS, works offline) + your own named places | The OS reverse geocoders call Google/Apple servers, so Stölk doesn't use them. You name a spot once ("IFEMA") and later captures within 250 m reuse that name. |

## Desktop (Linux, macOS, Windows)

The same screens run in an **Electron** window, via Expo's web build (react-native-web). Platform code is swapped with Metro's `.web.ts` files, so the retrieval pipeline (`src/rag`, `src/db/repo.ts`, `src/db/schema.ts`) is shared unchanged:

| Phone | Desktop (`*.web.ts` → `desktop/`) |
|---|---|
| op-sqlite + FTS5 + sqlite-vec | `node:sqlite` (bundled with Electron) + FTS5 + the `sqlite-vec` npm extension, in `desktop/sqlite.mjs` |
| llama.rn | node-llama-cpp with the same GGUF files, in `desktop/llm.mjs` |
| `Documents/models/` | `~/.config/stolk/models/` (Linux; the Electron `userData` folder elsewhere) |
| GPS | none: desktop geolocation goes through Google's network service, so captures have no location |

The database and models live in the main process (`desktop/main.mjs`). The window reaches them only through the IPC bridge in `desktop/preload.cjs`, with context isolation and the renderer sandbox enabled.

```bash
npm run desktop        # exports the web build to dist/ and opens the app
npm run web            # dev: Metro on :8081 …
npm run desktop:dev    # … and Electron loading it, with fast refresh
```

Needs Node ≥ 22.12 (Electron 44 and `node:sqlite` in tests). On Linux, if Electron aborts with *"The SUID sandbox helper binary was found, but is not configured correctly"*, run once:
`sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.

## How a question is answered (`src/rag/ask.ts`)

1. **Plan.** The local model fills a JSON schema `{event, place, near_me, date_from, date_to, person, company, topic}`, given today's date and your known events and places. A rule-based parser (`heuristicPlan`, English + Spanish) runs as well. Its sure hits are merged in, and it takes over entirely if the model is missing or over-filters.
2. **Retrieve.** SQL filters on encounters, events and places. GPS circles use a bounding-box prefilter plus an exact haversine check. `topic` ranks contacts by hybrid search: FTS5 (porter stemming) + sqlite-vec, fused with reciprocal rank fusion.
3. **Answer.** The local model writes a short answer from the numbered records only, citing them as [1], [2]. The result cards are shown underneath either way. Without a model you still get the list.

## Data model (`src/db/schema.ts`)

`contacts` (professional fields only) · `events` · `places` (name, lat/lng, radius) · `encounters` (contact, event, place, met_at, GPS, note) · `chunks` (+ `chunks_fts`, `chunk_vec`) for retrieval.

LinkedIn URLs are stored as links and are **never fetched**. That keeps Stölk within LinkedIn's terms and within the "only what the person gave you" boundary.

## Run it

```bash
npm install
npm test            # retrieval + planning tests on a real SQLite (node:sqlite, Node ≥ 22.5)
npm run typecheck
npx expo run:android   # needs Android Studio / SDK and a phone with USB debugging
```

Open **On-device models** in the app and download both models on Wi-Fi. To stay fully offline, copy the two `.gguf` files into the app's `Documents/models/` folder instead.

## Layout

```
app/            screens: index (timeline), capture, ask, models (shared by phone and desktop)
desktop/        Electron main process, preload bridge, SQLite and llama.cpp for the desktop
src/db/         schema + migrations, repository (capture, dedupe, place matching, embedding backfill)
src/rag/        plan (question → filters), retrieve (SQL + FTS + vector), answer (grounded prompt), ask (pipeline)
src/ai/         llama.rn wrappers, the model catalog and download (`*.web.ts`: desktop versions)
src/geo/        GPS and distance helpers
test/           node:test suite against in-memory SQLite
```

## Next

- Voice notes with whisper.rn (on-device speech-to-text).
- Paste-profile extraction: paste text, and the local model fills in company, role and headline.
- Import your own LinkedIn `Connections.csv`.
- Encrypted DB (op-sqlite SQLCipher build) and export/backup to a file.
