# Persistent Run Resume

**Date:** 2026-04-09
**Status:** Approved

## Problem

Active Codex runs are tracked purely in-memory via `runRegistry.ts`. When the app restarts or crashes, all running tasks are lost. Users must manually re-send messages to resume work.

## Goal

Automatically resume all interrupted Codex runs on app startup, transparently and without user intervention. If a run fails to resume, notify the user so they can retry or dismiss.

## Design

### Database Schema

New `runs` table in SQLite:

```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
  user_text TEXT NOT NULL,
  model TEXT,
  tier TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT,
  resume_attempts INTEGER DEFAULT 0
);
CREATE INDEX idx_runs_status ON runs(status);
```

- `interrupted` — new status for runs killed by app restart/crash
- `user_text` — original user message, needed to re-send on resume
- `resume_attempts` — tracks retries, capped at 3

### Run Lifecycle Changes

**On run creation (`createRun`):**
- Insert row into `runs` table with `status = 'running'`
- Store `user_text`, `model`, `tier`

**On run completion/failure/cancellation (`completeRun`):**
- Update DB row: set `status`, `ended_at`, `error`
- Continue existing 5-second delayed removal from in-memory registry

**On app shutdown (`before-quit`):**
- New `interruptAllRuns()` replaces `cancelAllRuns()`
- Kills Codex processes (same as today)
- Marks DB rows as `interrupted` instead of `cancelled`

**On app startup (after `initDb()`):**
1. Query `SELECT * FROM runs WHERE status IN ('running', 'interrupted')`
2. Any `running` rows are from a crash — update to `interrupted`
3. For each `interrupted` row: attempt resume

### Resume Flow

1. Look up conversation's `codex_thread_id` from DB
2. Re-create in-memory run record in registry
3. Re-spawn Codex with `resume {threadId}` (existing session resumption)
4. Increment `resume_attempts` in DB
5. Emit `CHAT_RUN_START` to renderer
6. **On success:** normal streaming flow, run completes as usual
7. **On failure:** emit `CHAT_RESUME_FAILED` to renderer with run details
8. Renderer shows notification: "Task in [conversation title] could not be resumed" with Retry / Dismiss
9. **Retry:** re-attempt resume (up to 3 total attempts)
10. **Dismiss:** mark run as `failed` with error "Could not resume after restart"

### IPC Changes

New channels:
- `CHAT_RESUME_FAILED` (event, main → renderer) — `{ runId, conversationId, conversationTitle, error, attempts }`
- `CHAT_RESUME_RETRY` (command, renderer → main) — `{ runId }`
- `CHAT_RESUME_DISMISS` (command, renderer → main) — `{ runId }`

### File Changes

| File | Change |
|------|--------|
| `src/main/db.ts` | Add `runs` table schema + migration, CRUD helpers: `insertRun`, `updateRunStatus`, `getInterruptedRuns` |
| `src/main/runRegistry.ts` | Call DB helpers on `createRun`, `completeRun`, `cancelRun`. Add `interruptAllRuns()` |
| `src/main/main.ts` | On startup: call `resumeInterruptedRuns()`. On quit: call `interruptAllRuns()` |
| `src/main/registerIpc.ts` | Add `CHAT_RESUME_RETRY` and `CHAT_RESUME_DISMISS` handlers |
| `src/shared/types.ts` | Add `'interrupted'` to `RunStatus` union |
| `src/main/ipc-channels.ts` | Add 3 new channel constants |
| `src/main/preload.ts` | Expose `chat.resumeRetry(runId)` and `chat.resumeDismiss(runId)` |
| `src/renderer/components/ChatPanel.tsx` | Listen for `CHAT_RESUME_FAILED`, show toast with retry/dismiss |
| `src/main/codex/codexChat.ts` | No changes — already supports resume via thread ID |

### Out of Scope

- Run history UI (table exists but not displayed)
- Run queuing (runs resume concurrently)
- Partial output recovery (resumed tasks start fresh from Codex thread)
- Settings toggle (auto-resume is always on)
- Conversation list spinner indicators (optional future polish)
