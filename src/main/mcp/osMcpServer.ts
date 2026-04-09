/**
 * MCP OS Control Server for Codex
 *
 * Standalone Node.js script that acts as an MCP STDIO server.
 * Codex CLI spawns this as a subprocess and communicates via MCP/STDIO.
 * Each tool handler executes OS-level commands via child_process.
 *
 * Architecture:
 *   Codex CLI --(MCP/STDIO)--> osMcpServer.js --(shell)--> xdotool / scrot / wmctrl / xclip
 *
 * Requires: xdotool, scrot, wmctrl, xclip, xdg-open, xprop, xdotool
 */

import { execFile, exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── Helpers ─────────────────────────────────────────────────────────────────

function mcpText(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

function mcpImage(base64: string, mimeType = 'image/png'): { content: Array<{ type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }> } {
  return {
    content: [
      { type: 'image' as const, data: base64, mimeType },
      { type: 'text' as const, text: '[screenshot captured]' },
    ],
  };
}

function mcpError(msg: string): { content: Array<{ type: 'text'; text: string }> } {
  return mcpText(`ERROR: ${msg}`);
}

async function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs });
  return stdout.trim();
}

async function runShell(cmd: string, timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
  return stdout.trim();
}

/** Parse xdotool getactivewindow getwindowgeometry output. */
export function parseWindowGeometry(output: string): { x: number; y: number; width: number; height: number } | null {
  const posMatch = output.match(/Position:\s*(\d+),(\d+)/);
  const sizeMatch = output.match(/Geometry:\s*(\d+)x(\d+)/);
  if (!posMatch || !sizeMatch) return null;
  return {
    x: parseInt(posMatch[1], 10),
    y: parseInt(posMatch[2], 10),
    width: parseInt(sizeMatch[1], 10),
    height: parseInt(sizeMatch[2], 10),
  };
}

/** Parse wmctrl -l output into structured window list. */
export function parseWmctrlList(output: string): Array<{ id: string; desktop: number; host: string; title: string }> {
  return output.split('\n').filter(Boolean).map(line => {
    const parts = line.split(/\s+/);
    const id = parts[0];
    const desktop = parseInt(parts[1], 10);
    const host = parts[2];
    const title = parts.slice(3).join(' ');
    return { id, desktop, host, title };
  });
}

/** Parse `ps aux` output into structured process list.
 *  ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
 *  The COMMAND field (index 10+) can contain spaces, so we take everything after field 10. */
export function parsePsList(output: string): Array<{ pid: number; user: string; cpu: string; mem: string; command: string }> {
  const lines = output.split('\n');
  return lines.slice(1).filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/);
    // ps aux has 11 fields minimum: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
    return {
      pid: parseInt(parts[1], 10),
      user: parts[0],
      cpu: parts[2],
      mem: parts[3],
      command: parts.slice(10).join(' '),
    };
  });
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'clawdia-os',
  version: '1.0.0',
});

// ── Tool 1: os_screenshot ──────────────────────────────────────────────────

server.tool(
  'os_screenshot',
  'Capture a screenshot of the entire desktop or a specific window. Returns the image as base64 PNG. Use this to SEE what is on the screen.',
  {
    window_id: z.string().optional().describe('X11 window ID to capture (from os_window_list). If omitted, captures the entire desktop.'),
    save_path: z.string().optional().describe('File path to save the PNG. If omitted, returns base64.'),
    delay_ms: z.number().optional().describe('Delay in milliseconds before capturing (default 0)'),
  },
  async ({ window_id, save_path, delay_ms }) => {
    try {
      const tmpPath = save_path || path.join(os.tmpdir(), `clawdia-screenshot-${Date.now()}.png`);
      const args: string[] = [];

      if (delay_ms && delay_ms > 0) {
        args.push('--delay', String(Math.ceil(delay_ms / 1000)));
      }

      if (window_id) {
        // Capture specific window by ID
        args.push('--window', window_id);
        // Include border
        args.push('--border');
      }

      args.push(tmpPath);
      await run('scrot', args, 15_000);

      if (save_path) {
        return mcpText(JSON.stringify({ ok: true, path: save_path }));
      }

      // Return as base64
      const imageBuffer = fs.readFileSync(tmpPath);
      const base64 = imageBuffer.toString('base64');
      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      return mcpImage(base64);
    } catch (err: unknown) {
      return mcpError(`screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 2: os_mouse_move ──────────────────────────────────────────────────

server.tool(
  'os_mouse_move',
  'Move the mouse cursor to an absolute screen position',
  {
    x: z.number().describe('X coordinate (pixels from left)'),
    y: z.number().describe('Y coordinate (pixels from top)'),
  },
  async ({ x, y }) => {
    try {
      await run('xdotool', ['mousemove', '--sync', String(x), String(y)]);
      return mcpText(JSON.stringify({ ok: true, x, y }));
    } catch (err: unknown) {
      return mcpError(`mouse_move failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 3: os_mouse_click ─────────────────────────────────────────────────

server.tool(
  'os_mouse_click',
  'Click the mouse at the current position, or move to (x, y) and click. button: 1=left, 2=middle, 3=right',
  {
    x: z.number().optional().describe('X coordinate to move to before clicking'),
    y: z.number().optional().describe('Y coordinate to move to before clicking'),
    button: z.number().optional().describe('Mouse button: 1=left (default), 2=middle, 3=right'),
    double_click: z.boolean().optional().describe('Double-click instead of single click'),
  },
  async ({ x, y, button, double_click }) => {
    try {
      const args: string[] = [];
      if (x !== undefined && y !== undefined) {
        // Move then click
        await run('xdotool', ['mousemove', '--sync', String(x), String(y)]);
      }
      args.push('click');
      if (double_click) args.push('--repeat', '2', '--delay', '50');
      args.push(String(button ?? 1));
      await run('xdotool', args);
      return mcpText(JSON.stringify({ ok: true, x, y, button: button ?? 1 }));
    } catch (err: unknown) {
      return mcpError(`mouse_click failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 4: os_key_type ────────────────────────────────────────────────────

server.tool(
  'os_key_type',
  'Type text using the keyboard, as if the user typed it. Sends to the currently focused window.',
  {
    text: z.string().describe('Text to type'),
    delay_ms: z.number().optional().describe('Delay between keystrokes in ms (default 12)'),
  },
  async ({ text, delay_ms }) => {
    try {
      const delay = delay_ms ?? 12;
      await run('xdotool', ['type', '--delay', String(delay), '--clearmodifiers', text], 30_000);
      return mcpText(JSON.stringify({ ok: true, typed: text.length + ' chars' }));
    } catch (err: unknown) {
      return mcpError(`key_type failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 5: os_key_press ───────────────────────────────────────────────────

server.tool(
  'os_key_press',
  'Press a key combination (e.g. "Return", "ctrl+c", "alt+Tab", "super"). Uses xdotool key names.',
  {
    keys: z.string().describe('Key combination: e.g. "Return", "ctrl+s", "alt+F4", "super", "Tab", "BackSpace", "ctrl+shift+t"'),
  },
  async ({ keys }) => {
    try {
      await run('xdotool', ['key', '--clearmodifiers', keys]);
      return mcpText(JSON.stringify({ ok: true, keys }));
    } catch (err: unknown) {
      return mcpError(`key_press failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 6: os_window_list ─────────────────────────────────────────────────

server.tool(
  'os_window_list',
  'List all open windows with their IDs, titles, and desktop numbers. Use the window ID for os_window_focus, os_window_resize, or os_screenshot.',
  {},
  async () => {
    try {
      const output = await run('wmctrl', ['-l']);
      const windows = parseWmctrlList(output);
      return mcpText(JSON.stringify({ ok: true, windows }));
    } catch (err: unknown) {
      return mcpError(`window_list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 7: os_window_focus ────────────────────────────────────────────────

server.tool(
  'os_window_focus',
  'Focus (activate/raise) a window by its ID from os_window_list, or by a name search',
  {
    window_id: z.string().optional().describe('X11 window ID (hex, e.g. "0x04600003") from os_window_list'),
    name: z.string().optional().describe('Window title substring to search for (uses first match)'),
  },
  async ({ window_id, name }) => {
    try {
      if (window_id) {
        await run('wmctrl', ['-i', '-a', window_id]);
        return mcpText(JSON.stringify({ ok: true, window_id }));
      }
      if (name) {
        await run('wmctrl', ['-a', name]);
        return mcpText(JSON.stringify({ ok: true, name }));
      }
      return mcpError('provide either window_id or name');
    } catch (err: unknown) {
      return mcpError(`window_focus failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 8: os_window_resize ───────────────────────────────────────────────

server.tool(
  'os_window_resize',
  'Move and/or resize a window. Use -1 for any value to keep it unchanged.',
  {
    window_id: z.string().optional().describe('X11 window ID. If omitted, targets the active window.'),
    x: z.number().optional().describe('New X position (-1 to keep current)'),
    y: z.number().optional().describe('New Y position (-1 to keep current)'),
    width: z.number().optional().describe('New width (-1 to keep current)'),
    height: z.number().optional().describe('New height (-1 to keep current)'),
  },
  async ({ window_id, x, y, width, height }) => {
    try {
      const gravity = '0'; // static gravity
      const mvResize = `${gravity},${x ?? -1},${y ?? -1},${width ?? -1},${height ?? -1}`;
      const args = ['-r', window_id || ':ACTIVE:', '-e', mvResize];
      if (window_id) args.splice(1, 1, '-i', '-r', window_id);
      // wmctrl -i -r <id> -e gravity,x,y,w,h
      const finalArgs = window_id
        ? ['-i', '-r', window_id, '-e', mvResize]
        : ['-r', ':ACTIVE:', '-e', mvResize];
      await run('wmctrl', finalArgs);
      return mcpText(JSON.stringify({ ok: true, x, y, width, height }));
    } catch (err: unknown) {
      return mcpError(`window_resize failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 9: os_clipboard_read ──────────────────────────────────────────────

server.tool(
  'os_clipboard_read',
  'Read the current contents of the system clipboard',
  {
    selection: z.string().optional().describe('"clipboard" (default, Ctrl+V) or "primary" (middle-click selection)'),
  },
  async ({ selection }) => {
    try {
      const sel = selection === 'primary' ? 'primary' : 'clipboard';
      const content = await run('xclip', ['-selection', sel, '-o'], 5_000);
      return mcpText(JSON.stringify({ ok: true, content }));
    } catch (err: unknown) {
      // xclip exits non-zero when clipboard is empty
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Error')) return mcpText(JSON.stringify({ ok: true, content: '' }));
      return mcpError(`clipboard_read failed: ${msg}`);
    }
  },
);

// ── Tool 10: os_clipboard_write ────────────────────────────────────────────

server.tool(
  'os_clipboard_write',
  'Write text to the system clipboard',
  {
    text: z.string().describe('Text to write to the clipboard'),
    selection: z.string().optional().describe('"clipboard" (default) or "primary"'),
  },
  async ({ text, selection }) => {
    try {
      const sel = selection === 'primary' ? 'primary' : 'clipboard';
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('xclip', ['-selection', sel], { stdio: ['pipe', 'ignore', 'pipe'] });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`xclip exit ${code}`)));
        proc.on('error', reject);
      });
      return mcpText(JSON.stringify({ ok: true, length: text.length }));
    } catch (err: unknown) {
      return mcpError(`clipboard_write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 11: os_app_launch ─────────────────────────────────────────────────

server.tool(
  'os_app_launch',
  'Launch an application. The app persists permanently — it will NOT close when this task ends. This tool waits for the app to fully start and register on D-Bus before returning, so you can immediately use os_media_control or os_dbus_call afterward.',
  {
    command: z.string().describe('Application name or command (e.g. "spotify", "firefox", "gedit /tmp/test.txt")'),
  },
  async ({ command }) => {
    try {
      const appName = command.split(/\s+/)[0].split('/').pop() || command;

      // Check if already running (use pgrep -x for exact name match to avoid matching ourselves)
      let pid = '';
      try { pid = await run('pgrep', ['-n', '-x', appName]); } catch { /* not running */ }
      const wasAlreadyRunning = !!pid;

      if (!wasAlreadyRunning) {
        // Launch in a new session so it survives parent death
        const child = spawn('setsid', ['-f', 'bash', '-c', command], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        });
        child.unref();
      }

      // Poll for D-Bus registration (up to 8 seconds)
      let dbus_registered = false;
      for (let i = 0; i < 16; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // Check PID
        if (!pid) {
          try { pid = await run('pgrep', ['-n', '-x', appName]); } catch { /* keep waiting */ }
        }
        // Check D-Bus
        if (!dbus_registered) {
          try {
            const busOutput = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames']);
            dbus_registered = busOutput.toLowerCase().includes(appName.toLowerCase());
          } catch { /* keep waiting */ }
        }
        // Done if we have both PID and D-Bus
        if (pid && dbus_registered) break;
        // Done if PID confirmed and we've waited at least 3s (app may not use D-Bus)
        if (pid && i >= 6) break;
      }

      return mcpText(JSON.stringify({
        ok: true,
        command,
        pid: pid || 'launched',
        already_running: wasAlreadyRunning,
        dbus_registered,
        ready: !!(pid && dbus_registered),
      }));
    } catch (err: unknown) {
      return mcpError(`app_launch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 12: os_process_list ───────────────────────────────────────────────

server.tool(
  'os_process_list',
  'List running processes, optionally filtered by name. Shows PID, user, CPU%, memory%, and command.',
  {
    filter: z.string().optional().describe('Filter processes by name substring (case-insensitive grep)'),
    limit: z.number().optional().describe('Max number of processes to return (default 30)'),
  },
  async ({ filter, limit }) => {
    try {
      const maxResults = limit ?? 30;
      let output: string;
      if (filter) {
        // Use pgrep + ps for filtered results
        output = await runShell(`ps aux | head -1; ps aux | grep -i ${JSON.stringify(filter)} | grep -v grep | head -${maxResults}`);
      } else {
        // Top processes by CPU
        output = await runShell(`ps aux --sort=-%cpu | head -${maxResults + 1}`);
      }
      const processes = parsePsList(output);
      return mcpText(JSON.stringify({ ok: true, count: processes.length, processes }));
    } catch (err: unknown) {
      return mcpError(`process_list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 13: os_get_active_window ──────────────────────────────────────────

server.tool(
  'os_get_active_window',
  'Get information about the currently focused/active window: title, geometry, window ID',
  {},
  async () => {
    try {
      const windowId = await run('xdotool', ['getactivewindow']);
      const name = await run('xdotool', ['getactivewindow', 'getwindowname']);
      const geometryStr = await run('xdotool', ['getactivewindow', 'getwindowgeometry']);
      const geometry = parseWindowGeometry(geometryStr);
      return mcpText(JSON.stringify({
        ok: true,
        window_id: windowId,
        title: name,
        geometry,
      }));
    } catch (err: unknown) {
      return mcpError(`get_active_window failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 14: os_screen_info ────────────────────────────────────────────────

server.tool(
  'os_screen_info',
  'Get screen resolution and display information',
  {},
  async () => {
    try {
      const output = await runShell('xdpyinfo 2>/dev/null | grep dimensions || xrandr 2>/dev/null | grep " connected"');
      return mcpText(JSON.stringify({ ok: true, display_info: output }));
    } catch (err: unknown) {
      return mcpError(`screen_info failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 15: os_dbus_call ───────────────────────────────────────────────────

server.tool(
  'os_dbus_call',
  'Call a D-Bus method. D-Bus is the IPC backbone of the Linux desktop — use it to control any app that exposes a D-Bus interface (media players via MPRIS, notifications, settings, screen recording, etc.). Use os_dbus_list to discover available services.',
  {
    bus: z.string().optional().describe('"session" (default, user apps) or "system" (system services)'),
    dest: z.string().describe('D-Bus service name (e.g. "org.mpris.MediaPlayer2.spotify", "org.freedesktop.Notifications")'),
    path: z.string().describe('Object path (e.g. "/org/mpris/MediaPlayer2", "/org/freedesktop/Notifications")'),
    method: z.string().describe('Full interface.method (e.g. "org.mpris.MediaPlayer2.Player.PlayPause", "org.freedesktop.DBus.Properties.Get")'),
    args: z.array(z.string()).optional().describe('Method arguments as strings. For typed args use gdbus syntax: "string:hello", "int32:42", "boolean:true"'),
  },
  async ({ bus, dest, path: objPath, method, args: methodArgs }) => {
    try {
      const busFlag = bus === 'system' ? '--system' : '--session';
      const gdbusParts = ['call', busFlag, '--dest', dest, '--object-path', objPath, '--method', method];
      if (methodArgs && methodArgs.length > 0) {
        gdbusParts.push(...methodArgs);
      }
      const output = await run('gdbus', gdbusParts, 10_000);
      return mcpText(JSON.stringify({ ok: true, result: output || '(void)' }));
    } catch (err: unknown) {
      return mcpError(`dbus_call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 16: os_dbus_list ──────────────────────────────────────────────────

server.tool(
  'os_dbus_list',
  'List available D-Bus services, optionally filtered. Use this to discover what apps/services can be controlled.',
  {
    bus: z.string().optional().describe('"session" (default) or "system"'),
    filter: z.string().optional().describe('Filter service names by substring (case-insensitive)'),
  },
  async ({ bus, filter }) => {
    try {
      const busFlag = bus === 'system' ? '--system' : '--session';
      const output = await run('gdbus', ['call', busFlag, '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames']);
      // Parse the gdbus array output: (['name1', 'name2', ...],)
      const names = (output.match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
      const filtered = filter
        ? names.filter(n => n.toLowerCase().includes(filter.toLowerCase()))
        : names.filter(n => !n.startsWith(':'));  // hide unique connection IDs by default
      return mcpText(JSON.stringify({ ok: true, count: filtered.length, services: filtered }));
    } catch (err: unknown) {
      return mcpError(`dbus_list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 17: os_dbus_introspect ────────────────────────────────────────────

server.tool(
  'os_dbus_introspect',
  'Introspect a D-Bus object to see its interfaces, methods, signals, and properties. Use this to discover what an app can do.',
  {
    bus: z.string().optional().describe('"session" (default) or "system"'),
    dest: z.string().describe('D-Bus service name'),
    path: z.string().optional().describe('Object path to introspect (default "/")'),
  },
  async ({ bus, dest, path: objPath }) => {
    try {
      const busFlag = bus === 'system' ? '--system' : '--session';
      const p = objPath || '/';
      const output = await run('gdbus', ['introspect', busFlag, '--dest', dest, '--object-path', p], 10_000);
      // Trim to reasonable size
      const trimmed = output.length > 4000 ? output.slice(0, 4000) + '\n[truncated]' : output;
      return mcpText(JSON.stringify({ ok: true, introspection: trimmed }));
    } catch (err: unknown) {
      return mcpError(`dbus_introspect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 18: os_media_control ──────────────────────────────────────────────

server.tool(
  'os_media_control',
  'Control any media player via MPRIS D-Bus (Spotify, Firefox, VLC, Chrome, etc.). Works with ANY app that implements the standard MPRIS interface. Use "list" first to see available players.',
  {
    action: z.string().describe('"list" | "play" | "pause" | "play_pause" | "next" | "previous" | "stop" | "status" | "open_uri"'),
    player: z.string().optional().describe('Player name from "list" output (e.g. "spotify", "firefox"). If omitted, targets the first available player.'),
    uri: z.string().optional().describe('URI for "open_uri" action (e.g. "spotify:track:xxx", "file:///path/to/music.mp3")'),
  },
  async ({ action, player, uri }) => {
    try {
      // Find MPRIS players on session bus
      const busOutput = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames']);
      const allNames = (busOutput.match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
      const mprisPlayers = allNames.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));

      if (action === 'list') {
        const players = mprisPlayers.map(n => n.replace('org.mpris.MediaPlayer2.', ''));
        return mcpText(JSON.stringify({ ok: true, players }));
      }

      // Resolve target player
      let target: string | null = null;
      if (player) {
        target = mprisPlayers.find(n => n.toLowerCase().includes(player.toLowerCase())) || null;
      } else {
        target = mprisPlayers[0] || null;
      }
      if (!target) {
        return mcpError(`no MPRIS player found${player ? ` matching "${player}"` : ''}. Available: ${mprisPlayers.map(n => n.replace('org.mpris.MediaPlayer2.', '')).join(', ') || 'none'}. If you just launched the app, wait a few seconds and retry — apps need time to register on D-Bus.`);
      }

      const mprisPath = '/org/mpris/MediaPlayer2';
      const playerIface = 'org.mpris.MediaPlayer2.Player';

      if (action === 'status') {
        const result = await run('gdbus', ['call', '--session', '--dest', target, '--object-path', mprisPath, '--method', 'org.freedesktop.DBus.Properties.GetAll', playerIface]);
        return mcpText(JSON.stringify({ ok: true, player: target, properties: result }));
      }

      if (action === 'open_uri' && uri) {
        await run('gdbus', ['call', '--session', '--dest', target, '--object-path', mprisPath, '--method', `${playerIface}.OpenUri`, uri]);
        return mcpText(JSON.stringify({ ok: true, player: target, action: 'open_uri', uri }));
      }

      const methodMap: Record<string, string> = {
        play: 'Play', pause: 'Pause', play_pause: 'PlayPause',
        next: 'Next', previous: 'Previous', stop: 'Stop',
      };
      const methodName = methodMap[action];
      if (!methodName) return mcpError(`unknown action "${action}". Use: list, play, pause, play_pause, next, previous, stop, status, open_uri`);

      await run('gdbus', ['call', '--session', '--dest', target, '--object-path', mprisPath, '--method', `${playerIface}.${methodName}`]);
      return mcpText(JSON.stringify({ ok: true, player: target, action }));
    } catch (err: unknown) {
      return mcpError(`media_control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 19: os_audio_control ──────────────────────────────────────────────

server.tool(
  'os_audio_control',
  'Control system audio: volume, mute, input/output device selection. Uses PipeWire/WirePlumber (wpctl).',
  {
    action: z.string().describe('"get_volume" | "set_volume" | "mute" | "unmute" | "toggle_mute" | "status"'),
    target: z.string().optional().describe('"output" (default, speakers/headphones) or "input" (microphone)'),
    volume: z.number().optional().describe('Volume level 0.0-1.5 for "set_volume" (1.0 = 100%)'),
  },
  async ({ action, target, volume }) => {
    try {
      const sink = target === 'input' ? '@DEFAULT_AUDIO_SOURCE@' : '@DEFAULT_AUDIO_SINK@';

      switch (action) {
        case 'get_volume': {
          const output = await run('wpctl', ['get-volume', sink]);
          return mcpText(JSON.stringify({ ok: true, raw: output }));
        }
        case 'set_volume': {
          if (volume === undefined) return mcpError('volume is required for set_volume');
          const clamped = Math.max(0, Math.min(1.5, volume));
          await run('wpctl', ['set-volume', sink, String(clamped)]);
          return mcpText(JSON.stringify({ ok: true, volume: clamped }));
        }
        case 'mute':
          await run('wpctl', ['set-mute', sink, '1']);
          return mcpText(JSON.stringify({ ok: true, muted: true }));
        case 'unmute':
          await run('wpctl', ['set-mute', sink, '0']);
          return mcpText(JSON.stringify({ ok: true, muted: false }));
        case 'toggle_mute':
          await run('wpctl', ['set-mute', sink, 'toggle']);
          return mcpText(JSON.stringify({ ok: true, action: 'toggle_mute' }));
        case 'status': {
          const output = await runShell('wpctl status 2>&1 | head -40');
          return mcpText(JSON.stringify({ ok: true, status: output }));
        }
        default:
          return mcpError(`unknown action "${action}". Use: get_volume, set_volume, mute, unmute, toggle_mute, status`);
      }
    } catch (err: unknown) {
      return mcpError(`audio_control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 20: os_notify ─────────────────────────────────────────────────────

server.tool(
  'os_notify',
  'Send a desktop notification. Appears in the system notification area.',
  {
    title: z.string().describe('Notification title'),
    body: z.string().optional().describe('Notification body text'),
    urgency: z.string().optional().describe('"low", "normal" (default), or "critical"'),
    expire_ms: z.number().optional().describe('Auto-dismiss time in ms (default: system decides)'),
  },
  async ({ title, body, urgency, expire_ms }) => {
    try {
      const args = [title];
      if (body) args.push(body);
      if (urgency) args.push('--urgency', urgency);
      if (expire_ms !== undefined) args.push('--expire-time', String(expire_ms));
      await run('notify-send', args);
      return mcpText(JSON.stringify({ ok: true, title }));
    } catch (err: unknown) {
      return mcpError(`notify failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 21: os_mouse_drag ─────────────────────────────────────────────────

server.tool(
  'os_mouse_drag',
  'Click-and-drag from one position to another. Holds the mouse button down while moving.',
  {
    from_x: z.number().describe('Start X coordinate'),
    from_y: z.number().describe('Start Y coordinate'),
    to_x: z.number().describe('End X coordinate'),
    to_y: z.number().describe('End Y coordinate'),
    button: z.number().optional().describe('Mouse button: 1=left (default), 2=middle, 3=right'),
    duration_ms: z.number().optional().describe('Duration of drag in ms (default 300)'),
  },
  async ({ from_x, from_y, to_x, to_y, button, duration_ms }) => {
    try {
      const btn = String(button ?? 1);
      // Move to start position
      await run('xdotool', ['mousemove', '--sync', String(from_x), String(from_y)]);
      // Press button
      await run('xdotool', ['mousedown', btn]);
      // Move to end position with delay for smooth drag
      const steps = Math.max(5, Math.floor((duration_ms ?? 300) / 20));
      const dx = (to_x - from_x) / steps;
      const dy = (to_y - from_y) / steps;
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from_x + dx * i);
        const y = Math.round(from_y + dy * i);
        await run('xdotool', ['mousemove', String(x), String(y)]);
      }
      // Release button
      await run('xdotool', ['mouseup', btn]);
      return mcpText(JSON.stringify({ ok: true, from: { x: from_x, y: from_y }, to: { x: to_x, y: to_y } }));
    } catch (err: unknown) {
      return mcpError(`mouse_drag failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 22: os_window_state ───────────────────────────────────────────────

server.tool(
  'os_window_state',
  'Change window state: minimize, maximize, fullscreen, restore, close, always-on-top, or move to a specific desktop/workspace.',
  {
    action: z.string().describe('"minimize" | "maximize" | "fullscreen" | "restore" | "close" | "above" | "below" | "shade"'),
    window_id: z.string().optional().describe('X11 window ID. If omitted, targets the active window.'),
    toggle: z.boolean().optional().describe('Toggle the state on/off instead of adding (default false)'),
  },
  async ({ action, window_id, toggle }) => {
    try {
      const target = window_id ? ['-i', '-r', window_id] : ['-r', ':ACTIVE:'];

      switch (action) {
        case 'minimize':
          if (window_id) {
            await run('xdotool', ['windowminimize', window_id]);
          } else {
            await run('xdotool', ['windowminimize', '--sync', await run('xdotool', ['getactivewindow'])]);
          }
          break;
        case 'close':
          await run('wmctrl', [...target, '-c', '']);
          break;
        case 'maximize':
        case 'fullscreen':
        case 'above':
        case 'below':
        case 'shade': {
          const wmProp = action === 'maximize' ? 'maximized_vert,maximized_horz'
            : action === 'fullscreen' ? 'fullscreen'
            : action === 'above' ? 'above'
            : action === 'below' ? 'below'
            : 'shaded';
          const addRemove = toggle ? 'toggle' : 'add';
          await run('wmctrl', [...target, '-b', `${addRemove},${wmProp}`]);
          break;
        }
        case 'restore':
          // Remove maximize and fullscreen
          await run('wmctrl', [...target, '-b', 'remove,maximized_vert,maximized_horz']);
          await run('wmctrl', [...target, '-b', 'remove,fullscreen']);
          break;
        default:
          return mcpError(`unknown action "${action}". Use: minimize, maximize, fullscreen, restore, close, above, below, shade`);
      }
      return mcpText(JSON.stringify({ ok: true, action, window_id: window_id || 'active' }));
    } catch (err: unknown) {
      return mcpError(`window_state failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 23: os_desktop_switch ─────────────────────────────────────────────

server.tool(
  'os_desktop_switch',
  'Switch to a different virtual desktop/workspace, or move a window to another desktop.',
  {
    desktop: z.number().describe('Desktop number (0-based)'),
    window_id: z.string().optional().describe('If provided, move this window to the target desktop instead of switching'),
  },
  async ({ desktop, window_id }) => {
    try {
      if (window_id) {
        await run('wmctrl', ['-i', '-r', window_id, '-t', String(desktop)]);
        return mcpText(JSON.stringify({ ok: true, moved_window: window_id, to_desktop: desktop }));
      }
      await run('wmctrl', ['-s', String(desktop)]);
      return mcpText(JSON.stringify({ ok: true, switched_to_desktop: desktop }));
    } catch (err: unknown) {
      return mcpError(`desktop_switch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 24: os_env_info ───────────────────────────────────────────────────

server.tool(
  'os_env_info',
  'Get information about the desktop environment, display server, and available capabilities. Call this first if unsure what tools will work on this system.',
  {},
  async () => {
    try {
      const info: Record<string, string> = {};
      info.session_type = process.env.XDG_SESSION_TYPE || 'unknown';
      info.desktop = process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || 'unknown';
      info.display = process.env.DISPLAY || 'none';
      info.wayland = process.env.WAYLAND_DISPLAY || 'none';

      // Check available tools
      const tools = ['xdotool', 'wmctrl', 'scrot', 'xclip', 'notify-send', 'wpctl', 'gdbus', 'playerctl', 'xdg-open'];
      const available: string[] = [];
      const missing: string[] = [];
      for (const t of tools) {
        try {
          await run('which', [t]);
          available.push(t);
        } catch {
          missing.push(t);
        }
      }
      info.available_tools = available.join(', ');
      info.missing_tools = missing.join(', ') || 'none';

      // Screen info
      try {
        info.screen = await runShell('xrandr 2>/dev/null | grep " connected" | head -3');
      } catch { info.screen = 'unavailable'; }

      return mcpText(JSON.stringify({ ok: true, ...info }));
    } catch (err: unknown) {
      return mcpError(`env_info failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Tool 25: os_xdotool ────────────────────────────────────────────────────

server.tool(
  'os_xdotool',
  'Run an arbitrary xdotool command for advanced input simulation. Use this for operations not covered by other tools (e.g. "windowactivate --sync 0x12345", "search --name Firefox", "getmouselocation").',
  {
    args: z.string().describe('xdotool arguments (e.g. "search --name Firefox", "getmouselocation", "windowactivate --sync 0x12345")'),
  },
  async ({ args: xdoArgs }) => {
    try {
      const output = await runShell(`xdotool ${xdoArgs}`, 15_000);
      return mcpText(JSON.stringify({ ok: true, output: output || '(no output)' }));
    } catch (err: unknown) {
      return mcpError(`xdotool failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[mcp-os] server started on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-os] fatal: ${err}\n`);
  process.exit(1);
});
