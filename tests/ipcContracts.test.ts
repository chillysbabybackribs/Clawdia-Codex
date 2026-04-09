/**
 * Tests that IPC event names in production match the shared constants.
 *
 * Anti-staleness: if an event name is changed in ipc-channels.ts
 * but not in the shared constant, this test fails.
 */

import { describe, it, expect } from 'vitest';
import { IPC_EVENTS } from '../src/main/ipc-channels';
import { IPC_EVENT_NAMES } from './helpers/contracts';

describe('IPC event name contracts', () => {
  it('CHAT_STREAM_TEXT matches', () => {
    expect(IPC_EVENTS.CHAT_STREAM_TEXT).toBe(IPC_EVENT_NAMES.CHAT_STREAM_TEXT);
  });

  it('CHAT_STREAM_END matches', () => {
    expect(IPC_EVENTS.CHAT_STREAM_END).toBe(IPC_EVENT_NAMES.CHAT_STREAM_END);
  });

  it('CHAT_RUN_START matches', () => {
    expect(IPC_EVENTS.CHAT_RUN_START).toBe(IPC_EVENT_NAMES.CHAT_RUN_START);
  });

  it('CHAT_RUN_END matches', () => {
    expect(IPC_EVENTS.CHAT_RUN_END).toBe(IPC_EVENT_NAMES.CHAT_RUN_END);
  });

  it('CHAT_TITLE_UPDATED matches', () => {
    expect(IPC_EVENTS.CHAT_TITLE_UPDATED).toBe(IPC_EVENT_NAMES.CHAT_TITLE_UPDATED);
  });

  it('CHAT_TOOL_ACTIVITY matches', () => {
    expect(IPC_EVENTS.CHAT_TOOL_ACTIVITY).toBe(IPC_EVENT_NAMES.CHAT_TOOL_ACTIVITY);
  });

  it('CHAT_VERIFICATION matches', () => {
    expect(IPC_EVENTS.CHAT_VERIFICATION).toBe(IPC_EVENT_NAMES.CHAT_VERIFICATION);
  });

  it('shared IPC_EVENT_NAMES covers all chat events from IPC_EVENTS', () => {
    const chatEvents = Object.entries(IPC_EVENTS)
      .filter(([key]) => key.startsWith('CHAT_'))
      .map(([key, value]) => [key, value] as const);

    for (const [key, value] of chatEvents) {
      expect((IPC_EVENT_NAMES as Record<string, string>)[key]).toBe(value);
    }
  });
});
