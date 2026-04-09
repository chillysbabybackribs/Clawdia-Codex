/**
 * Tests for OS MCP server pure logic.
 *
 * Tests the parsing functions exported from osMcpServer.
 * These are the most failure-prone parts — command output varies across systems.
 */

import { describe, it, expect } from 'vitest';
import {
  parseWindowGeometry,
  parseWmctrlList,
  parsePsList,
} from '../src/main/mcp/osMcpServer';

describe('osMcpServer parsing', () => {
  describe('parseWindowGeometry', () => {
    it('parses standard xdotool getwindowgeometry output', () => {
      const output = `Window 73400323
  Position: 100,200 (screen: 0)
  Geometry: 1280x720`;
      const result = parseWindowGeometry(output);
      expect(result).toEqual({ x: 100, y: 200, width: 1280, height: 720 });
    });

    it('parses geometry at origin', () => {
      const output = `Window 1234
  Position: 0,0 (screen: 0)
  Geometry: 1920x1080`;
      const result = parseWindowGeometry(output);
      expect(result).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });

    it('returns null for malformed output', () => {
      expect(parseWindowGeometry('')).toBeNull();
      expect(parseWindowGeometry('no data here')).toBeNull();
      expect(parseWindowGeometry('Position: 10,20')).toBeNull();
    });
  });

  describe('parseWmctrlList', () => {
    it('parses standard wmctrl -l output', () => {
      const output = `0x04600003  0 hostname Terminal
0x04a00002  0 hostname Firefox - Google`;
      const result = parseWmctrlList(output);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '0x04600003',
        desktop: 0,
        host: 'hostname',
        title: 'Terminal',
      });
      expect(result[1]).toEqual({
        id: '0x04a00002',
        desktop: 0,
        host: 'hostname',
        title: 'Firefox - Google',
      });
    });

    it('handles multi-desktop windows', () => {
      const output = `0x01  1 host Code - project
0x02  2 host Slack`;
      const result = parseWmctrlList(output);
      expect(result[0].desktop).toBe(1);
      expect(result[1].desktop).toBe(2);
    });

    it('handles empty output', () => {
      expect(parseWmctrlList('')).toEqual([]);
    });

    it('handles titles with multiple spaces', () => {
      const output = `0x01  0 host My Long   Title   Here`;
      const result = parseWmctrlList(output);
      expect(result[0].title).toBe('My Long Title Here');
    });
  });

  describe('parsePsList', () => {
    it('parses standard ps aux output', () => {
      const output = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 168340 12340 ?        Ss   10:00   0:01 /sbin/init
user        1234  5.2  1.3 512000 23456 ?        Sl   10:05   1:23 /usr/bin/firefox`;
      const result = parsePsList(output);
      expect(result).toHaveLength(2);
      expect(result[0].pid).toBe(1);
      expect(result[0].user).toBe('root');
      expect(result[0].cpu).toBe('0.0');
      expect(result[0].mem).toBe('0.1');
      expect(result[0].command).toContain('/sbin/init');
      expect(result[1].pid).toBe(1234);
      expect(result[1].cpu).toBe('5.2');
    });

    it('handles empty output', () => {
      expect(parsePsList('')).toEqual([]);
      expect(parsePsList('HEADER LINE\n')).toEqual([]);
    });

    it('handles commands with spaces', () => {
      const output = `HEADER
user  999  1.0  0.5 100 200 ? S 10:00 0:00 /usr/bin/some app --flag value`;
      const result = parsePsList(output);
      expect(result[0].command).toBe('/usr/bin/some app --flag value');
    });
  });
});
