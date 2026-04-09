# Clawdia-Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex-only Electron desktop AI workspace with embedded Chromium browser and visual search mirroring.

**Architecture:** Electron 36 + Vite + React 19 + TypeScript + Tailwind CSS 3. Single provider (Codex CLI), no routing layer. MCP browser server for structured browser tools. Browser mirror shows Codex's web searches in real-time.

**Tech Stack:** Electron, Vite, React 19, TypeScript, Tailwind CSS 3, better-sqlite3, @modelcontextprotocol/sdk, xterm, Monaco Editor

**Reference codebase:** `/home/dp/Desktop/Clawdia8` — read files there for patterns when implementing.

---

## File Map

```
Clawdia-Codex/
├── package.json                          # Task 1
├── tsconfig.json                         # Task 1
├── tsconfig.main.json                    # Task 1
├── vite.config.ts                        # Task 1
├── tailwind.config.cjs                   # Task 1
├── postcss.config.cjs                    # Task 1
├── .gitignore                            # Task 1
├── AGENTS.md                             # Task 1
├── src/shared/types.ts                   # Task 2
├── src/shared/models.ts                  # Task 2
├── src/main/main.ts                      # Task 3
├── src/main/ipc-channels.ts              # Task 3
├── src/main/db.ts                        # Task 3
├── src/main/settingsStore.ts             # Task 3
├── src/main/preload.ts                   # Task 4
├── src/main/registerIpc.ts               # Task 4 (+ Task 7 update)
├── src/main/browser/BrowserService.ts    # Task 5
├── src/main/browser/ElectronBrowserService.ts # Task 5
├── src/main/browserBridge.ts             # Task 6
├── src/main/bridge.ts                    # Task 6
├── src/main/codex/codexChat.ts           # Task 7
├── src/main/mcp/browserMcpServer.ts      # Task 8
├── src/renderer/main.tsx                 # Task 9
├── src/renderer/index.html               # Task 9
├── src/renderer/index.css                # Task 9
├── src/renderer/global.d.ts              # Task 9
├── src/renderer/components/AppChrome.tsx  # Task 10
├── src/renderer/components/MarkdownRenderer.tsx # Task 10
├── src/renderer/components/ToolActivity.tsx     # Task 10
├── src/renderer/tabLogic.ts              # Task 11
├── src/renderer/components/TabStrip.tsx  # Task 11
├── src/renderer/components/ChatPanel.tsx # Task 12
├── src/renderer/components/InputBar.tsx  # Task 12
├── src/renderer/components/BrowserPanel.tsx     # Task 13
├── src/renderer/components/ConversationsView.tsx # Task 14
├── src/renderer/components/SettingsView.tsx      # Task 14
├── src/renderer/components/WelcomeScreen.tsx     # Task 14
├── src/renderer/components/EditorPanel.tsx       # Task 14
├── src/renderer/components/TerminalPanel.tsx     # Task 14
├── src/renderer/App.tsx                  # Task 15
└── (integration verification)            # Task 16
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.cjs`
- Create: `postcss.config.cjs`
- Create: `.gitignore`
- Create: `AGENTS.md`

**Reference:** Read `/home/dp/Desktop/Clawdia8/package.json`, `/home/dp/Desktop/Clawdia8/tsconfig.json`, `/home/dp/Desktop/Clawdia8/tsconfig.main.json`, `/home/dp/Desktop/Clawdia8/vite.config.ts`, `/home/dp/Desktop/Clawdia8/tailwind.config.cjs`, `/home/dp/Desktop/Clawdia8/postcss.config.cjs` for the patterns. Adapt them for Clawdia-Codex (remove openai, @google/genai; add @modelcontextprotocol/sdk; change name to clawdia-codex).

- [ ] **Step 1: Create package.json**

Key changes from Clawdia8:
- name: `clawdia-codex`
- Remove `openai` and `@google/genai` from dependencies
- Add `@modelcontextprotocol/sdk` to dependencies
- Keep all other deps identical

- [ ] **Step 2: Create tsconfig.json (renderer)**

Identical to Clawdia8's tsconfig.json.

- [ ] **Step 3: Create tsconfig.main.json**

Identical to Clawdia8's tsconfig.main.json.

- [ ] **Step 4: Create vite.config.ts**

Identical to Clawdia8's vite.config.ts.

- [ ] **Step 5: Create tailwind.config.cjs**

Identical to Clawdia8's tailwind.config.cjs.

- [ ] **Step 6: Create postcss.config.cjs**

Identical to Clawdia8's postcss.config.cjs.

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
*.sqlite
.env
```

- [ ] **Step 8: Create AGENTS.md**

Use the AGENTS.md content from the design spec Section 11 verbatim.

- [ ] **Step 9: Install dependencies**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 10: Verify TypeScript compiles (empty)**

Run: `cd /home/dp/Desktop/Clawdia-Codex && mkdir -p src/main src/shared src/renderer && npx tsc -p tsconfig.main.json --noEmit 2>&1 || true`
Expected: May warn about no input files — that's fine at this stage.

- [ ] **Step 11: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add package.json tsconfig.json tsconfig.main.json vite.config.ts tailwind.config.cjs postcss.config.cjs .gitignore AGENTS.md package-lock.json
git commit -m "feat: project scaffolding with dependencies"
```

---

### Task 2: Shared Types & Models

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/models.ts`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/shared/types.ts` and `/home/dp/Desktop/Clawdia8/src/shared/model-registry.ts`.

- [ ] **Step 1: Create src/shared/types.ts**

Same as Clawdia8's `types.ts` but remove the `ProviderId` import/re-export. Keep: `MessageAttachment`, `Message`, `ToolCall`, `Conversation`, `BrowserTab`.

- [ ] **Step 2: Create src/shared/models.ts**

New file with just 3-tier Codex model config:

```typescript
export type Tier = 'fast' | 'balanced' | 'deep';

export interface TierConfig {
  label: string;
  model: string;
  description: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  fast:     { label: 'Fast',     model: 'gpt-5.4-nano', description: 'Quick responses' },
  balanced: { label: 'Balanced', model: 'gpt-5.4-mini', description: 'Good balance of speed and depth' },
  deep:     { label: 'Deep',     model: 'gpt-5.4',      description: 'Maximum capability' },
};

export const DEFAULT_TIER: Tier = 'balanced';

export function getTierModel(tier: Tier): string {
  return TIERS[tier].model;
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/shared/
git commit -m "feat: shared types and 3-tier model config"
```

---

### Task 3: Main Process Foundation

**Files:**
- Create: `src/main/main.ts`
- Create: `src/main/ipc-channels.ts`
- Create: `src/main/db.ts`
- Create: `src/main/settingsStore.ts`

**Reference:** Read the corresponding files in `/home/dp/Desktop/Clawdia8/src/main/`.

- [ ] **Step 1: Create src/main/ipc-channels.ts**

Same structure as Clawdia8 but:
- Remove all API_KEY_*, MODEL_*, SETTINGS_GET_PROVIDER*, SETTINGS_SET_PROVIDER* channels
- Add TIER_GET, TIER_SET channels
- Add BROWSER_MIRROR_NAVIGATE and BROWSER_MIRROR_DONE events
- Remove CHAT_EXECUTOR_INFO event

```typescript
export const IPC = {
  CHAT_SEND: 'chat:send',
  CHAT_STOP: 'chat:stop',
  CHAT_NEW: 'chat:new',
  CHAT_CREATE: 'chat:create',
  CHAT_LIST: 'chat:list',
  CHAT_LOAD: 'chat:load',
  CHAT_DELETE: 'chat:delete',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_REFRESH: 'browser:refresh',
  BROWSER_SET_BOUNDS: 'browser:set-bounds',
  BROWSER_TAB_NEW: 'browser:tab:new',
  BROWSER_TAB_LIST: 'browser:tab:list',
  BROWSER_TAB_SWITCH: 'browser:tab:switch',
  BROWSER_TAB_CLOSE: 'browser:tab:close',
  BROWSER_HISTORY_MATCH: 'browser:history-match',
  BROWSER_HIDE: 'browser:hide',
  BROWSER_SHOW: 'browser:show',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  TIER_GET: 'tier:get',
  TIER_SET: 'tier:set',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const;

export const IPC_EVENTS = {
  CHAT_STREAM_TEXT: 'chat:stream:text',
  CHAT_STREAM_END: 'chat:stream:end',
  CHAT_TITLE_UPDATED: 'chat:title-updated',
  CHAT_TOOL_ACTIVITY: 'chat:tool-activity',
  BROWSER_URL_CHANGED: 'browser:url-changed',
  BROWSER_TITLE_CHANGED: 'browser:title-changed',
  BROWSER_LOADING: 'browser:loading',
  BROWSER_TABS_CHANGED: 'browser:tabs-changed',
  BROWSER_AUTO_SHOW: 'browser:auto-show',
  BROWSER_MIRROR_NAVIGATE: 'browser:mirror-navigate',
  BROWSER_MIRROR_DONE: 'browser:mirror-done',
} as const;
```

- [ ] **Step 2: Create src/main/db.ts**

Clone Clawdia8's `db.ts` pattern but:
- Config dir: `~/.config/clawdia/` (not `clawdia8`)
- Schema: `codex_thread_id` column added directly in CREATE TABLE (not ALTER TABLE)
- Remove the `try { ALTER TABLE }` migration block — clean schema from start

- [ ] **Step 3: Create src/main/settingsStore.ts**

Simplified from Clawdia8:
- `AppSettings` = `{ tier: Tier; uiSession: unknown }`
- No providerKeys, provider, models, routerEnabled
- Config dir uses `app.getPath('userData')` which for app name `clawdia` gives `~/.config/clawdia/`
- Default: `{ tier: 'balanced', uiSession: null }`

- [ ] **Step 4: Create src/main/main.ts**

Clone Clawdia8's `main.ts` pattern but:
- `app.setName('clawdia')` instead of `clawdia8`
- Import paths adjusted (no router, no multi-provider)
- Import `registerIpc` and `startBrowserBridge` (will create stubs first)

For now, create a minimal version that just opens the window. The registerIpc and startBrowserBridge calls will be wired in later tasks.

- [ ] **Step 5: Build main process**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles (may need stub files for imports — create empty stubs if needed)

- [ ] **Step 6: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/main.ts src/main/ipc-channels.ts src/main/db.ts src/main/settingsStore.ts
git commit -m "feat: main process foundation - electron entry, db, settings"
```

---

### Task 4: Preload & IPC Bridge

**Files:**
- Create: `src/main/preload.ts`
- Create: `src/main/registerIpc.ts`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/main/preload.ts` and `/home/dp/Desktop/Clawdia8/src/main/registerIpc.ts`.

- [ ] **Step 1: Create src/main/preload.ts**

Clone Clawdia8's preload but:
- `chat.send(message, attachments?, conversationId?, tier?)` — tier replaces provider+model
- Remove `chat.onExecutorInfo`
- Remove `settings.getApiKey`, `setApiKey`, `getModel`, `setModel`, `getProvider`, `setProvider`, `getProviderKeys`
- Add `settings.getTier()` and `settings.setTier(tier)`
- Add `browser.onMirrorNavigate(callback)` and `browser.onMirrorDone(callback)`

- [ ] **Step 2: Create src/main/registerIpc.ts**

Clone Clawdia8's registerIpc but:
- Remove all OpenAI/Gemini/Fireworks imports and provider switching
- Remove router logic (no directActions, flashRouter, executors imports)
- CHAT_SEND handler: always calls `streamCodexChat` directly
- Settings handlers: only SETTINGS_GET, SETTINGS_SET, TIER_GET, TIER_SET
- Remove API_KEY_*, MODEL_*, PROVIDER_* handlers
- Import `streamCodexChat` from `./codex/codexChat` (will exist in Task 7)

For now, stub the CHAT_SEND handler to just echo back — it will be completed in Task 7.

- [ ] **Step 3: Wire up main.ts**

Update `src/main/main.ts` to import and call `registerIpc(browserService)` and `startBrowserBridge(browserService)`. The browserService won't exist yet, so create type-compatible stubs or use `as any` temporarily.

- [ ] **Step 4: Build and verify**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/preload.ts src/main/registerIpc.ts src/main/main.ts
git commit -m "feat: preload context bridge and IPC registration"
```

---

### Task 5: Browser Service

**Files:**
- Create: `src/main/browser/BrowserService.ts`
- Create: `src/main/browser/ElectronBrowserService.ts`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/main/core/browser/BrowserService.ts` and `/home/dp/Desktop/Clawdia8/src/main/core/browser/ElectronBrowserService.ts`.

- [ ] **Step 1: Create src/main/browser/BrowserService.ts**

Identical to Clawdia8's BrowserService interface. Same methods: init, navigate, back, forward, refresh, setBounds, newTab, listTabs, switchTab, closeTab, matchHistory, hide, show, getActiveWebContents, getWebContentsByTabId.

- [ ] **Step 2: Create src/main/browser/ElectronBrowserService.ts**

Clone Clawdia8's ElectronBrowserService but:
- Partition: `persist:clawdia-browser` (not `clawdia8-browser`)
- Import from `../../ipc-channels` (not `../../ipc-channels` — same relative path, different file)
- Everything else identical — same tab management, same loadUrlReady, same event binding

- [ ] **Step 3: Update main.ts imports**

Update `src/main/main.ts` to properly import `ElectronBrowserService` from `./browser/ElectronBrowserService`.

- [ ] **Step 4: Build and verify**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles.

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/browser/
git commit -m "feat: browser service with Electron BrowserView tabs"
```

---

### Task 6: Browser Bridge (HTTP Server)

**Files:**
- Create: `src/main/browserBridge.ts`
- Create: `src/main/bridge.ts`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/main/browserBridge.ts` and `/home/dp/Desktop/Clawdia8/src/main/bridge.ts`.

- [ ] **Step 1: Create src/main/bridge.ts**

Identical to Clawdia8's bridge.ts — HTTP client helper.

- [ ] **Step 2: Create src/main/browserBridge.ts**

Clone Clawdia8's browserBridge.ts with ALL existing endpoints, PLUS add these new endpoints:

**New: GET /snapshot** — Accessibility tree extraction with ref IDs.
- Query params: `interactive_only` (bool), `max_depth` (number), `tab_id` (string)
- Runs JS in page to walk DOM and build simplified a11y tree
- Assigns ref IDs (`e1`, `e2`, ...) to interactive elements
- Stores ref-to-selector map in memory per tab
- Returns JSON tree

**New: POST /click-ref** — Click element by ref ID.
- Query params: `ref` (string), `tab_id` (string)
- Resolves ref → selector from stored map → executes click

**New: POST /type-ref** — Type into element by ref ID.
- Query params: `ref` (string), `text` (string), `clear` (bool), `tab_id` (string)
- Resolves ref → selector → focus, set value, dispatch events

**New: POST /scroll** — Scroll page or to element.
- Query params: `direction` (up/down/left/right), `amount` (number), `ref` (string), `tab_id` (string)

**New: POST /wait** — Wait for condition.
- Query params: `condition` (element/text/networkidle/js/ms), `value` (string), `timeout_ms` (number), `tab_id` (string)
- Polls condition until met or timeout

**New: POST /find** — Natural language element search.
- Query params: `description` (string), `tab_id` (string)
- Runs JS to match elements by text content, aria-label, placeholder, title
- Returns matching elements with ref IDs

For the ref ID management, add a module-level `Map<string, Map<string, string>>` (tabId → refId → CSS selector). Invalidate on navigation events.

The snapshot JS should build a tree like:
```json
[
  { "ref": "e1", "tag": "a", "role": "link", "name": "Home", "href": "/", "text": "Home" },
  { "ref": "e2", "tag": "input", "role": "textbox", "name": "", "placeholder": "Search...", "value": "" }
]
```

- [ ] **Step 3: Build and verify**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/browserBridge.ts src/main/bridge.ts
git commit -m "feat: browser bridge with snapshot, ref-based interaction, and wait primitives"
```

---

### Task 7: Codex Chat Provider

**Files:**
- Create: `src/main/codex/codexChat.ts`
- Modify: `src/main/registerIpc.ts` — wire up CHAT_SEND

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/main/providers/codexChat.ts` and `/home/dp/Desktop/Clawdia8/src/main/registerIpc.ts`.

- [ ] **Step 1: Create src/main/codex/codexChat.ts**

Clone Clawdia8's codexChat.ts with these changes:

1. **System prompt** — Update to include browser MCP tools documentation (from AGENTS.md)
2. **Browser mirror detection** — After parsing each `item.completed` or `item.started`, check for web search/browser activity:
   - If `itemType === 'web_search'`: extract query from item properties, build Google search URL, emit `BROWSER_MIRROR_NAVIGATE`
   - If item command contains `browser navigate`: extract URL, emit `BROWSER_MIRROR_NAVIGATE`
   - If item command contains `curl` with a URL: extract URL, emit `BROWSER_MIRROR_NAVIGATE`
   - On tool completion after a mirror event: emit `BROWSER_MIRROR_DONE`
3. **SCRIPTS_DIR** — Same pattern, resolves to project root `/scripts/`
4. **Import** `IPC_EVENTS` for mirror events

The mirror detection function:
```typescript
function detectMirrorUrl(item: Record<string, unknown>): string | null {
  const itemType = typeof item.type === 'string' ? item.type : '';
  // web_search tool
  if (itemType === 'web_search') {
    const query = typeof item.query === 'string' ? item.query
      : typeof item.input === 'string' ? item.input : null;
    if (query) return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
  // Shell command with browser navigate
  const command = typeof item.command === 'string' ? item.command : '';
  if (command.includes('browser navigate')) {
    const match = command.match(/browser\s+navigate\s+(\S+)/);
    if (match) return match[1];
  }
  // Shell command with curl
  if (command.includes('curl')) {
    const match = command.match(/curl\s+(?:-[^\s]+\s+)*["']?(https?:\/\/[^\s"']+)/);
    if (match) return match[1];
  }
  return null;
}
```

Emit mirror events:
```typescript
const mirrorUrl = detectMirrorUrl(itemRecord);
if (mirrorUrl && !webContents.isDestroyed()) {
  webContents.send(IPC_EVENTS.BROWSER_MIRROR_NAVIGATE, { url: mirrorUrl, conversationId });
}
```

- [ ] **Step 2: Update src/main/registerIpc.ts — wire CHAT_SEND**

Replace the stub CHAT_SEND handler with the real one:
- Import `streamCodexChat` from `./codex/codexChat`
- Import `getTierModel` from `../shared/models`
- On CHAT_SEND: extract `{ text, attachments, conversationId, tier }`
- Resolve model from tier using `getTierModel(tier || getSetting('tier'))`
- Create/fetch conversation in DB
- Save user message
- Call `streamCodexChat({ webContents, userText, model, conversationId, signal })`
- Save assistant response
- Auto-title from first message

No router. No provider switching. Just straight to Codex.

- [ ] **Step 3: Build and verify**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/codex/ src/main/registerIpc.ts
git commit -m "feat: codex chat provider with browser mirror detection"
```

---

### Task 8: MCP Browser Server

**Files:**
- Create: `src/main/mcp/browserMcpServer.ts`

**Reference:** `@modelcontextprotocol/sdk` STDIO server pattern.

- [ ] **Step 1: Create src/main/mcp/browserMcpServer.ts**

This is a standalone Node.js script that:
1. Creates an MCP STDIO server using `@modelcontextprotocol/sdk`
2. Registers 12 tools (8 core + 4 enhanced)
3. Each tool handler makes HTTP requests to the browser bridge at `http://127.0.0.1:3111`

The bridge port comes from `BROWSER_BRIDGE_PORT` env or defaults to 3111.

Tool implementations — each tool maps to a bridge HTTP call:

| MCP Tool | Bridge Call |
|---|---|
| `browser_navigate` | `GET /navigate?url=...` (or `/back`, `/forward` for special values) |
| `browser_snapshot` | `GET /snapshot?interactive_only=...&max_depth=...` |
| `browser_click` | `POST /click-ref?ref=...` |
| `browser_type` | `POST /type-ref?ref=...&text=...&clear=...` |
| `browser_scroll` | `POST /scroll?direction=...&amount=...&ref=...` |
| `browser_wait` | `POST /wait?condition=...&value=...&timeout_ms=...` |
| `browser_screenshot` | `GET /screenshot?save_path=...` |
| `browser_get_text` | `GET /page-text` |
| `browser_tabs` | Various: `/tabs`, `/tabs/new`, `/tabs/switch`, `/tabs/close` based on `action` param |
| `browser_execute_js` | `POST /execute-js` with code as body |
| `browser_extract_links` | `GET /extract-links` |
| `browser_find` | `POST /find?description=...` |

Each tool returns the bridge JSON response as a text content block.

Use the `http` module (no external deps) to call the bridge, same pattern as `bridge.ts`.

- [ ] **Step 2: Build and verify**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/main/mcp/
git commit -m "feat: MCP browser server with 12 tools for Codex"
```

---

### Task 9: Renderer Entry & Styles

**Files:**
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/index.html`
- Create: `src/renderer/index.css`
- Create: `src/renderer/global.d.ts`

**Reference:** Read the corresponding files in `/home/dp/Desktop/Clawdia8/src/renderer/`.

- [ ] **Step 1: Create src/renderer/main.tsx**

Identical to Clawdia8's main.tsx.

- [ ] **Step 2: Create src/renderer/index.html**

Clone Clawdia8's index.html. Title stays "Clawdia" (already correct).

- [ ] **Step 3: Create src/renderer/index.css**

Clone Clawdia8's index.css entirely — all the markdown prose styles, streaming cursor, tool activity, status line, codex-specific animations, tab styles, etc. Change the "CLAWDIA 8" text references to "CLAWDIA" in comments only (CSS doesn't contain the text).

- [ ] **Step 4: Create src/renderer/global.d.ts**

Updated type declaration for `window.clawdia`:
- `chat.send(message, attachments?, conversationId?, tier?)` — tier replaces provider+model
- Remove `chat.onExecutorInfo`
- Remove all API key/model/provider settings methods
- Add `settings.getTier(): Promise<string>`
- Add `settings.setTier(tier: string): Promise<void>`
- Add `browser.onMirrorNavigate(cb): () => void`
- Add `browser.onMirrorDone(cb): () => void`
- Add `browser.onAutoShow(cb): () => void`

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/main.tsx src/renderer/index.html src/renderer/index.css src/renderer/global.d.ts
git commit -m "feat: renderer entry point, styles, and type declarations"
```

---

### Task 10: Renderer Core Components

**Files:**
- Create: `src/renderer/components/AppChrome.tsx`
- Create: `src/renderer/components/MarkdownRenderer.tsx`
- Create: `src/renderer/components/ToolActivity.tsx`

**Reference:** Read the corresponding files in `/home/dp/Desktop/Clawdia8/src/renderer/components/`.

- [ ] **Step 1: Create src/renderer/components/AppChrome.tsx**

Clone Clawdia8's AppChrome.tsx but change branding:
- `"Clawdia 8"` → `"Clawdia"`
- `"Workspace"` → `"Codex"` (subtitle)

- [ ] **Step 2: Create src/renderer/components/MarkdownRenderer.tsx**

Identical to Clawdia8's MarkdownRenderer.tsx. No changes needed — it already links to browser via `clawdia.browser.navigate`.

- [ ] **Step 3: Create src/renderer/components/ToolActivity.tsx**

Identical to Clawdia8's ToolActivity.tsx. The tool display names already cover browser_ and codex_ prefixed tools.

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/components/AppChrome.tsx src/renderer/components/MarkdownRenderer.tsx src/renderer/components/ToolActivity.tsx
git commit -m "feat: app chrome, markdown renderer, and tool activity components"
```

---

### Task 11: Renderer Tab System

**Files:**
- Create: `src/renderer/tabLogic.ts`
- Create: `src/renderer/components/TabStrip.tsx`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/renderer/tabLogic.ts` and `/home/dp/Desktop/Clawdia8/src/renderer/components/TabStrip.tsx`.

- [ ] **Step 1: Create src/renderer/tabLogic.ts**

Clone Clawdia8's tabLogic.ts but simplify the mode type:
- Remove `'claude_terminal'` from mode union — Codex-only app
- Keep: `'chat' | 'codex_terminal' | 'concurrent'`

- [ ] **Step 2: Create src/renderer/components/TabStrip.tsx**

Clone Clawdia8's TabStrip.tsx but:
- Remove `import ExecutorIdentity from './ExecutorIdentity'`
- Remove `<ExecutorIdentity mode={tab.mode} isActive={isActive} />` from the tab content
- Keep everything else (drag-to-reorder, status icons, close buttons)

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/tabLogic.ts src/renderer/components/TabStrip.tsx
git commit -m "feat: tab logic and tab strip component"
```

---

### Task 12: Renderer Chat & Input

**Files:**
- Create: `src/renderer/components/ChatPanel.tsx`
- Create: `src/renderer/components/InputBar.tsx`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/renderer/components/ChatPanel.tsx` and `/home/dp/Desktop/Clawdia8/src/renderer/components/InputBar.tsx`.

- [ ] **Step 1: Create src/renderer/components/InputBar.tsx**

Clone Clawdia8's InputBar.tsx but:
- Remove provider selector (`DEFAULT_PROVIDER`, `PROVIDERS` imports)
- Remove `provider` state and `providerLabel`
- Replace the "Powered by {providerLabel}" badge with a tier indicator
- Import `TIERS, DEFAULT_TIER, type Tier` from `../../shared/models`
- Add tier state: `const [tier, setTier] = useState<Tier>(DEFAULT_TIER)`
- On mount, load tier from settings: `api.settings.getTier().then(t => setTier(t as Tier))`
- Tier selector: small dropdown or 3-segment toggle in the footer area
- `onSend` callback: pass tier instead of provider
- Remove VPN button (InputVpnButton)

The tier selector in the footer:
```tsx
<div className="flex items-center gap-1">
  {(['fast', 'balanced', 'deep'] as const).map(t => (
    <button
      key={t}
      onClick={() => { setTier(t); api?.settings.setTier(t); }}
      className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
        tier === t ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
      }`}
    >
      {TIERS[t].label}
    </button>
  ))}
</div>
```

- [ ] **Step 2: Create src/renderer/components/ChatPanel.tsx**

Clone Clawdia8's ChatPanel.tsx but:
- Remove `executorInfo` state and `onExecutorInfo` subscription
- Remove the executor routing indicator section (the colored badges for flash/pro/gpt/codex)
- Remove `onConversationMetaResolved` call that derives tab mode from executors
- `handleSend` passes `tier` instead of `provider, model`
- Keep everything else: messages, streaming, tool activity, auto-scroll, stream subscriptions

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/components/ChatPanel.tsx src/renderer/components/InputBar.tsx
git commit -m "feat: chat panel and input bar with tier selection"
```

---

### Task 13: Renderer Browser Panel

**Files:**
- Create: `src/renderer/components/BrowserPanel.tsx`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/renderer/components/BrowserPanel.tsx`.

- [ ] **Step 1: Create src/renderer/components/BrowserPanel.tsx**

Clone Clawdia8's BrowserPanel.tsx with these additions:

1. **Mirror state tracking:**
```typescript
const [mirrorActive, setMirrorActive] = useState(false);
const [mirrorTabs, setMirrorTabs] = useState<Set<string>>(new Set());
```

2. **Subscribe to mirror events:**
```typescript
useEffect(() => {
  const api = (window as any).clawdia?.browser;
  if (!api) return;
  const cleanups: (() => void)[] = [];

  if (api.onMirrorNavigate) {
    cleanups.push(api.onMirrorNavigate((payload: { url: string }) => {
      setMirrorActive(true);
      // The URL is navigated by the main process — we just show the indicator
    }));
  }

  if (api.onMirrorDone) {
    cleanups.push(api.onMirrorDone(() => {
      setMirrorActive(false);
    }));
  }

  return () => cleanups.forEach(fn => fn());
}, []);
```

3. **Mirror indicator in the toolbar:**
After the omnibox, when `mirrorActive` is true, show:
```tsx
{mirrorActive && (
  <div className="flex items-center gap-2 flex-shrink-0 px-2">
    <span className="codex-orb" />
    <span className="text-[10px] font-medium text-emerald-400/70 tracking-wide uppercase">
      Codex is browsing
    </span>
  </div>
)}
```

4. **Update branding:** Change `"CLAWDIA 8 BROWSER"` to `"CLAWDIA BROWSER"` in the new tab overlay.

- [ ] **Step 2: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/components/BrowserPanel.tsx
git commit -m "feat: browser panel with Codex mirror indicator"
```

---

### Task 14: Renderer Side Views

**Files:**
- Create: `src/renderer/components/ConversationsView.tsx`
- Create: `src/renderer/components/SettingsView.tsx`
- Create: `src/renderer/components/WelcomeScreen.tsx`
- Create: `src/renderer/components/EditorPanel.tsx`
- Create: `src/renderer/components/TerminalPanel.tsx`

**Reference:** Read the corresponding files in `/home/dp/Desktop/Clawdia8/src/renderer/components/`.

- [ ] **Step 1: Create src/renderer/components/ConversationsView.tsx**

Identical to Clawdia8's ConversationsView.tsx. No changes needed.

- [ ] **Step 2: Create src/renderer/components/SettingsView.tsx**

Completely rewritten — much simpler:
- No provider selector, no API key inputs, no model list
- Just a tier selector (3 radio-style options) and an about section
- Load/save tier via `api.settings.getTier()` / `api.settings.setTier(tier)`

```tsx
import React, { useState, useEffect } from 'react';
import { TIERS, DEFAULT_TIER, type Tier } from '../../shared/models';

interface SettingsViewProps {
  onBack: () => void;
}

export default function SettingsView({ onBack }: SettingsViewProps) {
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    api.settings.getTier().then((t: string) => {
      if (t === 'fast' || t === 'balanced' || t === 'deep') setTier(t);
    });
  }, []);

  const handleSave = async () => {
    const api = (window as any).clawdia;
    if (!api) return;
    await api.settings.setTier(tier);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sectionCardClass = 'flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4';

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <span className="text-xs text-text-tertiary">Settings</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-[480px] flex flex-col gap-6">
          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Model Tier</label>
            <p className="text-2xs text-text-muted -mt-1">Choose the performance tier for Codex responses.</p>
            <div className="flex flex-col gap-1">
              {(Object.entries(TIERS) as [Tier, typeof TIERS[Tier]][]).map(([key, config]) => (
                <label
                  key={key}
                  className={`flex items-start px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    tier === key ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <input type="radio" name="tier" value={key} checked={tier === key} onChange={() => setTier(key)} className="sr-only" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-primary">{config.label}</span>
                    <span className="text-2xs text-text-muted">{config.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">About</label>
            <div className="text-2xs text-text-muted space-y-1">
              <p>Clawdia — Codex AI Workspace</p>
              <p>Powered by OpenAI Codex CLI. Authentication is handled by the Codex CLI directly.</p>
            </div>
          </section>
        </div>
      </div>
      <div className="sticky bottom-0 flex-shrink-0 border-t border-border-subtle bg-surface-0/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-[480px]">
          <button
            onClick={handleSave}
            className={`h-[38px] w-full rounded-xl text-sm font-medium transition-all cursor-pointer ${saved ? 'bg-status-success/20 text-status-success' : 'bg-accent/90 hover:bg-accent text-surface-0'}`}
          >
            {saved ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create src/renderer/components/WelcomeScreen.tsx**

Simplified — no API key input since Codex handles its own auth:

```tsx
import React from 'react';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="flex flex-col items-center gap-6 max-w-[400px] w-full">
        <div className="flex flex-col items-center gap-2">
          <div className="text-[28px] font-bold text-text-primary tracking-tight">Clawdia</div>
          <div className="text-sm text-text-tertiary text-center leading-relaxed">
            AI desktop workspace powered by Codex.
          </div>
        </div>
        <div className="w-full h-px bg-white/[0.06]" />
        <div className="flex flex-col gap-2 w-full">
          {[
            ['Terminal', 'Execute commands, install packages, run builds'],
            ['Browser', 'Search, navigate, click, extract data from any site'],
            ['Files', 'Read, write, edit files anywhere on your system'],
            ['Memory', 'Remembers facts and context across conversations'],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-3 py-1">
              <div className="w-1 h-1 rounded-full bg-accent/60 mt-[7px] flex-shrink-0" />
              <div>
                <span className="text-2xs font-medium text-text-secondary">{title}</span>
                <span className="text-2xs text-text-muted"> -- {desc}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onComplete}
          className="w-full h-[42px] rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all cursor-pointer"
        >
          Get Started
        </button>
        <p className="text-2xs text-text-muted text-center">
          Make sure you have the Codex CLI installed and authenticated.
          Run <code className="font-mono text-text-secondary">codex --version</code> to verify.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create src/renderer/components/EditorPanel.tsx**

Identical to Clawdia8's EditorPanel.tsx stub.

- [ ] **Step 5: Create src/renderer/components/TerminalPanel.tsx**

Identical to Clawdia8's TerminalPanel.tsx stub.

- [ ] **Step 6: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/components/ConversationsView.tsx src/renderer/components/SettingsView.tsx src/renderer/components/WelcomeScreen.tsx src/renderer/components/EditorPanel.tsx src/renderer/components/TerminalPanel.tsx
git commit -m "feat: conversations, settings, welcome, editor, and terminal views"
```

---

### Task 15: Renderer App Root

**Files:**
- Create: `src/renderer/App.tsx`

**Reference:** Read `/home/dp/Desktop/Clawdia8/src/renderer/App.tsx`.

- [ ] **Step 1: Create src/renderer/App.tsx**

Clone Clawdia8's App.tsx with these changes:

1. **Remove hasApiKey flow** — No API key check. Since Codex handles auth, the app starts directly. Instead of `hasApiKey` gating, use a simple `ready` flag that starts `true` (or show WelcomeScreen on first launch via a `hasSeenWelcome` setting).

   Replace the `hasApiKey` state with:
   ```typescript
   const [showWelcome, setShowWelcome] = useState<boolean | null>(null);
   ```
   On mount, check `api.settings.get('hasSeenWelcome')`. If falsy, show WelcomeScreen. On complete, set `hasSeenWelcome` to true.

2. **Remove provider-related session hydration** — No `getProviderKeys()` check. Session hydration happens immediately.

3. **Remove executor info subscription** — No `onExecutorInfo` anywhere.

4. **Add mirror event subscriptions:**
   ```typescript
   useEffect(() => {
     const api = (window as any).clawdia?.browser;
     if (!api?.onMirrorNavigate) return;
     const unsub = api.onMirrorNavigate(() => {
       setRightPaneMode('browser');
     });
     return () => unsub?.();
   }, []);
   ```

5. **Remove `ExecutorIdentity` import** — not used.

6. **Remove lazy ConversationsView/SettingsView — use direct imports** for simplicity (can lazy load later if needed).

7. **handleSend in ChatPanel** passes tier instead of provider/model.

8. **Keep all keyboard shortcuts**, tab management, view transitions, session persistence.

- [ ] **Step 2: Verify renderer builds**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx vite build`
Expected: Builds to dist/renderer/ without errors.

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add src/renderer/App.tsx
git commit -m "feat: app root with tab system, mirror subscriptions, and session persistence"
```

---

### Task 16: Integration & Final Verification

**Files:**
- Modify: any files needing final fixes from build/type errors

- [ ] **Step 1: Build main process**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx tsc -p tsconfig.main.json`
Fix any type errors.

- [ ] **Step 2: Build renderer**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npx vite build`
Fix any type/import errors.

- [ ] **Step 3: Full dev mode test**

Run: `cd /home/dp/Desktop/Clawdia-Codex && npm run dev`
Expected:
- Electron window opens with "Clawdia" title bar
- Welcome screen shows on first launch
- After clicking "Get Started", chat view loads
- Browser panel visible on right
- Can type a message and send it
- Codex CLI spawns and responds (requires `codex` to be installed)

- [ ] **Step 4: Test browser mirror**

Send a message that triggers Codex web search (e.g., "search the web for the latest Node.js release").
Expected:
- Codex performs web search
- In-app browser automatically navigates to the search URL
- "Codex is browsing" indicator appears in browser toolbar
- Indicator clears when search completes

- [ ] **Step 5: Test tier selection**

Open Settings, change tier to "Fast", save. Send a new message.
Expected: Codex uses the gpt-5.4-nano model.

- [ ] **Step 6: Test conversation persistence**

Send a message, note the response. Close and reopen the app.
Expected: Conversation appears in Conversations view. Loading it restores messages.

- [ ] **Step 7: Final commit**

```bash
cd /home/dp/Desktop/Clawdia-Codex
git add -A
git commit -m "feat: Clawdia-Codex v1.0 — complete build"
```

---

## Implementation Notes

### Key Differences from Clawdia8

| Aspect | Clawdia8 | Clawdia-Codex |
|---|---|---|
| Providers | OpenAI, Gemini, Codex, Fireworks | Codex only |
| Model selection | Per-provider model dropdown | 3-tier (Fast/Balanced/Deep) |
| Router | Gemini Flash decomposition + multi-executor | None — direct to Codex |
| API keys | Stored in settings per provider | None — Codex CLI handles auth |
| Browser tools | Shell CLI wrapper only | Shell CLI + MCP server (12 tools) |
| Browser mirror | Not present | Codex searches shown in browser |
| Config dir | ~/.config/clawdia8/ | ~/.config/clawdia/ |
| Browser partition | persist:clawdia8-browser | persist:clawdia-browser |

### Files NOT ported from Clawdia8

- `src/main/providers/clients.ts` — no multi-provider clients
- `src/main/providers/openaiChat.ts` — no OpenAI provider
- `src/main/providers/geminiChat.ts` — no Gemini provider
- `src/main/router/flashRouter.ts` — no router
- `src/main/router/executors.ts` — no executors
- `src/main/router/directActions.ts` — no direct actions
- `src/main/router/routingTypes.ts` — no routing types
- `src/main/router/contextWindow.ts` — no context windowing
- `src/main/router/streamBatcher.ts` — no stream batching
- `src/renderer/components/ExecutorIdentity.tsx` — no multi-executor display
