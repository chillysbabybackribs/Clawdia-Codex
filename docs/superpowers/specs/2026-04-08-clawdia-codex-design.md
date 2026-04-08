# Clawdia-Codex Design Specification

**Date:** 2026-04-08  
**Project:** Clawdia-Codex  
**Directory:** `/home/dp/Desktop/Clawdia-Codex`  
**Description:** Codex-only Electron desktop AI workspace with embedded Chromium browser, built clean-room from scratch.

---

## 1. Overview

Clawdia-Codex is a standalone Electron desktop application that provides a chat interface to OpenAI's Codex CLI agent with an embedded Chromium browser. It is a clean-room build inspired by Clawdia8 but stripped to a single provider (Codex) with no routing layer.

**Core differentiator:** When Codex performs web searches, the in-app browser visually mirrors the pages being searched in real-time. Codex's native search functionality is unchanged — the browser is a visual mirror only, no content flows back to Codex.

**Branding:** "Clawdia" (no suffix)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron 36 |
| Bundler | Vite 6 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS 3 + PostCSS |
| Database | SQLite via better-sqlite3 |
| Terminal | xterm 5 |
| Code editor | Monaco Editor |
| MCP SDK | @modelcontextprotocol/sdk |
| AI backend | Codex CLI (spawned as child process) |

**Removed from Clawdia8:** `openai`, `@google/genai` — no multi-provider clients needed.

---

## 3. Project Structure

```
Clawdia-Codex/
├── src/
│   ├── main/
│   │   ├── main.ts                # Electron entry point, window creation
│   │   ├── preload.ts             # Context bridge (window.clawdia API)
│   │   ├── ipc-channels.ts        # IPC channel constants
│   │   ├── registerIpc.ts         # IPC handler registration
│   │   ├── db.ts                  # SQLite layer
│   │   ├── settingsStore.ts       # Settings persistence (tier + UI state)
│   │   ├── browserBridge.ts       # HTTP server for browser control (port 3111)
│   │   ├── bridge.ts              # HTTP client to bridge
│   │   ├── codex/
│   │   │   └── codexChat.ts       # Codex CLI spawning, JSON stream parsing, mirror detection
│   │   ├── mcp/
│   │   │   └── browserMcpServer.ts # MCP STDIO server for Codex browser tools
│   │   └── browser/
│   │       ├── BrowserService.ts          # Interface
│   │       └── ElectronBrowserService.ts  # BrowserView implementation
│   ├── renderer/
│   │   ├── main.tsx               # React entry point
│   │   ├── App.tsx                # Root component, view/tab/pane management
│   │   ├── index.html
│   │   ├── index.css
│   │   ├── tabLogic.ts            # Tab state management
│   │   └── components/
│   │       ├── AppChrome.tsx      # Window frame controls
│   │       ├── ChatPanel.tsx      # Messages, streaming, tool activity
│   │       ├── InputBar.tsx       # Message input, tier selector, file upload
│   │       ├── BrowserPanel.tsx   # Embedded browser viewport + tab strip
│   │       ├── SettingsView.tsx   # Tier selector + about section
│   │       ├── ConversationsView.tsx # Sidebar conversation list
│   │       ├── ToolActivity.tsx   # Running/completed tool display
│   │       ├── MarkdownRenderer.tsx # React-markdown with GFM
│   │       ├── EditorPanel.tsx    # Monaco editor
│   │       ├── TerminalPanel.tsx  # xterm terminal
│   │       ├── TabStrip.tsx       # Tab management UI
│   │       └── WelcomeScreen.tsx  # Landing screen
│   └── shared/
│       ├── types.ts               # Message, Conversation, BrowserTab, ToolCall
│       └── models.ts              # 3-tier Codex model mapping
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.main.json
├── tailwind.config.cjs
├── postcss.config.cjs
├── AGENTS.md
└── .gitignore
```

---

## 4. Model System

Three tiers mapped to Codex models. No provider selection, no API key management.

| Tier | Label | Codex Model |
|---|---|---|
| fast | Fast | codex-gpt-5.4-nano |
| balanced | Balanced | codex-gpt-5.4-mini |
| deep | Deep | codex-gpt-5.4 |

```typescript
// src/shared/models.ts
type Tier = 'fast' | 'balanced' | 'deep';

interface TierConfig {
  label: string;
  model: string;
  description: string;
}

const TIERS: Record<Tier, TierConfig> = {
  fast:     { label: 'Fast',     model: 'codex-gpt-5.4-nano', description: 'Quick responses' },
  balanced: { label: 'Balanced', model: 'codex-gpt-5.4-mini', description: 'Good balance of speed and depth' },
  deep:     { label: 'Deep',     model: 'codex-gpt-5.4',      description: 'Maximum capability' },
};
```

---

## 5. Codex Integration

### Spawning

Codex CLI is spawned as a child process using `codex exec --dangerously-bypass-approvals-and-sandbox --json`. Same pattern as Clawdia8.

### Session Persistence

- Thread IDs stored in SQLite `conversations.codex_thread_id`
- In-memory session map for active conversations
- Resume via `codex exec ... resume <thread_id> -`

### System Prompt

Provided on first message of a conversation. Includes:
- Agent identity and capabilities
- Shell tool documentation
- Browser CLI wrapper commands
- Browser MCP tool descriptions and workflow patterns
- Concise coding approach guidelines

### Stream Parsing

JSON stream items from Codex stdout:
- `thread.started` → persist thread ID
- `item.started` (non-text) → emit tool activity "running"
- `item.updated` / `item.completed` (agent_message/reasoning) → stream text deltas
- `item.completed` (tools) → emit tool activity "success" + check for browser mirror
- `item.failed` → emit tool activity "error"

### Inactivity Timeout

10-minute timeout with reset on any stdout data. Kills child process on timeout.

---

## 6. Browser Mirror

### Purpose

When Codex performs web searches, the in-app Chromium browser navigates to the same URLs in real-time so the user can see what Codex is reading. Codex's search functionality is completely unchanged — the mirror is fire-and-forget.

### Detection (in codexChat.ts)

| Item Pattern | Action |
|---|---|
| `item.type === 'web_search'` | Extract query → build `google.com/search?q=...` URL |
| `item.type === 'browser'` | Extract URL from arguments |
| `item.command` contains `curl` | Extract URL from command |
| `item.command` contains `browser navigate` | Extract URL from arguments |

### IPC Events

```typescript
BROWSER_MIRROR_NAVIGATE  // { url: string, conversationId: string }
BROWSER_MIRROR_DONE      // { conversationId: string }
```

### Behavior

- If browser panel is hidden → auto-show it
- If user has focus on browser → mirror opens a background tab
- Multiple rapid searches → each gets its own tab (max 5 mirror tabs, recycles oldest)
- Mirror tabs are visually distinguished (label: "via Codex")
- User can close mirror tabs freely
- If cached web search (no live URL) → construct search URL from query text
- If browser bridge unreachable → silently fail, Codex unaffected

---

## 7. Browser Bridge (HTTP Server)

HTTP server on port 3111 (configurable via `BROWSER_BRIDGE_PORT` env var). Provides browser control for both the CLI wrapper and the MCP server.

### Existing Endpoints (from Clawdia8 pattern)

| Method | Path | Purpose |
|---|---|---|
| GET | `/navigate?url=...` | Navigate tab |
| GET | `/back`, `/forward`, `/refresh` | Navigation controls |
| GET | `/tabs` | List all tabs |
| POST | `/tabs/new?url=...&activate=true` | Create tab |
| POST | `/tabs/switch?id=...` | Switch active tab |
| POST | `/tabs/close?id=...` | Close tab |
| GET | `/page-text?tabId=...` | Extract visible text |
| GET | `/extract-links?tabId=...` | Extract links |
| POST | `/click?selector=...&tabId=...` | Click element |
| POST | `/type?selector=...&text=...&tabId=...` | Type into input |
| GET | `/query?selector=...&tabId=...` | Query elements |

### New Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/snapshot?interactive_only=true&max_depth=5&tab_id=...` | Accessibility tree with ref IDs |
| POST | `/click-ref?ref=...&tab_id=...` | Click element by ref ID |
| POST | `/type-ref?ref=...&text=...&clear=false&tab_id=...` | Type into element by ref ID |
| POST | `/scroll?direction=...&amount=...&ref=...&tab_id=...` | Scroll page or to element |
| POST | `/wait?condition=...&value=...&timeout_ms=...&tab_id=...` | Wait for condition |
| GET | `/screenshot?save_path=...&tab_id=...` | Capture viewport |
| POST | `/find?description=...&tab_id=...` | Natural language element search |

### Ref ID Management

- `/snapshot` assigns short ref IDs (`e1`, `e2`, ...) to interactive elements
- Ref-to-selector map stored in memory per tab
- Map invalidated on navigation or after 60 seconds
- `/click-ref` and `/type-ref` resolve ref → selector → execute

### Accessibility Tree Extraction

Runs JavaScript in page via `webContents.executeJavaScript()`:
- Walks DOM building simplified tree: tag, role, name, text, href, value, checked, ref ID
- `interactive_only` filters to: links, buttons, inputs, selects, textareas, `[role=button]`, `[contenteditable]`
- `max_depth` limits tree depth for token control
- Returns structured JSON

---

## 8. MCP Browser Server

### Architecture

```
Codex CLI ──(MCP/STDIO)──► browserMcpServer.js ──(HTTP)──► browserBridge ──► ElectronBrowserService
```

STDIO MCP server spawned by Codex CLI. Translates MCP tool calls into HTTP requests to the browser bridge.

### Configuration

Shipped as part of the app. Codex connects via project-scoped `.codex/config.toml`:

```toml
[mcp_servers.clawdia_browser]
command = "node"
args = ["${APP_PATH}/dist/main/mcp/browserMcpServer.js"]  # APP_PATH resolved at runtime by Electron
startup_timeout_sec = 5
tool_timeout_sec = 30
```

### Tool Definitions

**Core (8 tools):**

| Tool | Parameters | Returns |
|---|---|---|
| `browser_navigate` | `{url: string}` ("back"/"forward" as special values) | `{url, title}` |
| `browser_snapshot` | `{interactive_only?: bool, max_depth?: number}` | Accessibility tree JSON with ref IDs |
| `browser_click` | `{ref: string}` | `{success: bool}` |
| `browser_type` | `{ref: string, text: string, clear?: bool}` | `{success: bool}` |
| `browser_scroll` | `{direction: "up"\|"down"\|"left"\|"right", amount?: number, ref?: string}` | `{success: bool}` |
| `browser_wait` | `{condition: "element"\|"text"\|"networkidle"\|"js"\|"ms", value: string, timeout_ms?: number}` | `{met: bool}` |
| `browser_screenshot` | `{save_path?: string}` | Base64 string or `{path: string}` |
| `browser_get_text` | `{}` | `{text: string}` |

**Enhanced (4 tools):**

| Tool | Parameters | Returns |
|---|---|---|
| `browser_tabs` | `{action: "list"\|"create"\|"switch"\|"close", tab_id?: string, url?: string}` | Tab list or result |
| `browser_execute_js` | `{code: string}` | Execution result |
| `browser_extract_links` | `{}` | `{links: [{text, href}]}` |
| `browser_find` | `{description: string}` | `{matches: [{ref, tag, text, role}]}` |

---

## 9. Data Layer

### SQLite Schema

```sql
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  codex_thread_id TEXT
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role            TEXT CHECK(role IN ('user','assistant')),
  content         TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  attachments_json TEXT
);

CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
```

**Pragmas:** WAL mode, foreign_keys enabled.

**DB path:** `~/.config/clawdia/data.sqlite`

### Settings

```typescript
interface AppSettings {
  tier: 'fast' | 'balanced' | 'deep';
  uiSession: unknown;
}
```

**Settings path:** `~/.config/clawdia/clawdia-settings.json`

No API key storage. Codex CLI handles its own authentication.

---

## 10. UI Architecture

### Layout

Left panel (chat / conversations / settings) + right panel (browser / editor / terminal). Same split-pane layout as Clawdia8.

### Components

| Component | Description | Delta from Clawdia8 |
|---|---|---|
| AppChrome | Window frame, min/max/close | Title → "Clawdia" |
| ChatPanel | Messages, streaming text, tool activity | Remove executor identity badges |
| InputBar | Message input, file upload, tier selector | Tier selector replaces provider+model dropdowns |
| BrowserPanel | Embedded browser + tab strip | Add "Codex is browsing" indicator + mirror tab badges |
| SettingsView | Tier selector + about section | Remove API keys, provider config, router toggle |
| ConversationsView | Sidebar conversation list, search, delete | Identical |
| ToolActivity | Running/completed tool calls with duration | Identical |
| MarkdownRenderer | React-markdown with GFM support | Identical |
| EditorPanel | Monaco editor | Identical |
| TerminalPanel | xterm terminal | Identical |
| TabStrip | Tab management UI | Identical |
| WelcomeScreen | Landing screen | Updated branding |

### Removed Components

- **ExecutorIdentity** — no multi-executor routing

### Tab System

```typescript
interface ConversationTab {
  id: string;
  conversationId: string | null;
  title?: string;
  mode?: 'chat' | 'codex_terminal' | 'concurrent';
  status?: 'idle' | 'running' | 'completed' | 'failed';
}
```

### Right Pane Modes

```typescript
type RightPane = 'browser' | 'editor' | 'terminal' | 'none';
```

### Preload API

```typescript
window.clawdia = {
  chat: {
    send(message, attachments?, conversationId?, tier?),
    stop(conversationId?),
    new(), create(), list(), load(id), delete(id),
    onStreamText(callback),
    onStreamEnd(callback),
    onTitleUpdated(callback),
    onToolActivity(callback),
  },
  browser: {
    navigate(url), back(), forward(), refresh(),
    setBounds(bounds),
    newTab(url?), listTabs(), switchTab(id), closeTab(id),
    matchHistory(prefix),
    hide(), show(),
    onUrlChanged(callback), onTitleChanged(callback),
    onLoading(callback), onTabsChanged(callback),
    onAutoShow(callback),
    onMirrorNavigate(callback),  // NEW: browser mirror events
    onMirrorDone(callback),      // NEW: browser mirror completion
  },
  settings: {
    get(key), set(key, value),
    getTier(), setTier(tier),
  },
  window: {
    minimize(), maximize(), close(),
  },
};
```

---

## 11. AGENTS.md

```markdown
# Clawdia Agent Instructions

You are Codex, an autonomous coding agent running inside the Clawdia
desktop app. You have shell access with no approval gates.

## Tools

### Shell (bash)
Your primary tool. Use for file operations, code, builds, tests, git.

### In-App Browser (via shell)
Quick commands for simple navigation:
  browser navigate <url>
  browser page-text
  browser tabs
  browser back | forward | refresh

### Browser MCP Tools (structured automation)
For complex browser tasks, use the MCP browser tools:
  browser_navigate  — go to URL or "back"/"forward"
  browser_snapshot  — get page accessibility tree with ref IDs
  browser_click     — click element by ref ID
  browser_type      — type into element by ref ID
  browser_scroll    — scroll page or to ref
  browser_wait      — wait for element/text/network idle
  browser_screenshot — capture viewport
  browser_get_text  — extract readable page content
  browser_tabs      — list/create/switch/close tabs
  browser_find      — find element by natural language description

### Workflow Patterns
- **Research:** navigate → get_text → (repeat across tabs)
- **Interact:** navigate → snapshot → click/type → wait → snapshot
- **Multi-tab:** tabs create → navigate (tab A) → tabs create → navigate (tab B) → get_text from both

## Approach
1. Read and understand before changing.
2. Make targeted changes. Don't rewrite files unnecessarily.
3. Verify your work after changes.
4. Use browser_snapshot before interacting with page elements.
5. Prefer ref IDs over CSS selectors for clicking/typing.

## Session Continuity
Conversations persist via session IDs. Context is retained across turns.
```

---

## 12. Electron Configuration

| Setting | Value |
|---|---|
| Window size | 1400x900 (min 800x600) |
| Frame | false (custom chrome) |
| Background | #0f0f0f |
| Preload | Context isolation enabled, sandbox disabled |
| Browser partition | persist:clawdia-browser |
| Config directory | ~/.config/clawdia/ |
| Linux optimizations | Hardware acceleration disabled, unsafe Swiftshader fallback |

---

## 13. Build Scripts

```json
{
  "dev": "concurrently \"npm:dev:main\" \"npm:dev:renderer\" \"npm:dev:electron\"",
  "dev:main": "nodemon --watch src/main -e ts --exec \"tsc -p tsconfig.main.json\"",
  "dev:renderer": "vite --port 5174",
  "dev:electron": "nodemon --watch dist/main --exec \"electron dist/main/main.js\"",
  "build": "npm run build:main && npm run build:renderer",
  "build:main": "tsc -p tsconfig.main.json",
  "build:renderer": "vite build",
  "start:stable": "electron dist/main/main.js"
}
```

---

## 14. Out of Scope

- Multi-provider support (OpenAI, Gemini, Fireworks)
- Router / task decomposition system
- API key management
- Content flowing from browser back to Codex (mirror is visual only)
- Codex subagent/multi-agent orchestration from the app (Codex handles this internally)
