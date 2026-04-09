# Clawdia Codex

Clawdia Codex is an Electron desktop workspace for coding with an embedded browser and multi-provider chat. It combines a React renderer, Electron main process, browser automation hooks, and Codex-style chat orchestration in one local app.

## What It Does

- Embedded Chromium browser with tab management and navigation controls
- Chat-driven coding workflow wired through the Electron main process
- Browser automation support through an MCP browser server and `browser` shell commands
- Local desktop layout with browser, editor, terminal, and chat panes
- Test coverage for browser verification, IPC contracts, content blocks, and run lifecycle behavior

## Tech Stack

- Electron
- React 19
- Vite
- TypeScript
- Vitest
- `better-sqlite3`

## Requirements

- Node.js 20+
- npm

## Getting Started

```bash
npm install
```

Native modules are rebuilt automatically during install via `@electron/rebuild`.

## Development

Start the full development environment:

```bash
npm run dev
```

Useful scripts:

```bash
npm run build
npm run test
npm run test:watch
npm run safe-dev
```

## Project Structure

- `src/main` Electron main process, IPC wiring, Codex orchestration, browser services, MCP server
- `src/renderer` React UI
- `src/shared` shared types
- `tests` Vitest test suite

## Notes

- The app is configured for CommonJS output in the Electron main process.
- The embedded browser uses a persistent Electron session partition.
- Browser automation support is exposed both through shell-friendly `browser` commands and MCP browser tools.

## License

MIT
