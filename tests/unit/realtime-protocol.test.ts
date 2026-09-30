import { describe, expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';
import { decodeRealtimeSignal, encodeRealtimeSignal } from '@/server/realtime/publish';
import { encodeSseEvent, encodeSseRetry, formatEventCursor, parseEventCursor, SSE_HEADERS } from '@/server/realtime/sse';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '6b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';

describe('realtime protocol', () => {
  it('decodes only well-formed signals', () => {
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 'n', u: USER, id: OTHER, m: 'created' }))).toEqual({ t: 'n', u: USER, id: OTHER, m: 'created' });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 'u', u: USER }))).toEqual({ t: 'u', u: USER });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 's', u: USER, keep: OTHER }))).toEqual({ t: 's', u: USER, keep: OTHER });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 's', u: USER, sid: OTHER }))).toEqual({ t: 's', u: USER, sid: OTHER });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 's', u: USER }))).toEqual({ t: 's', u: USER });
    expect(decodeRealtimeSignal(JSON.stringify({ t: 'n', u: USER, id: OTHER, m: 'deleted' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ t: 's', u: USER, sid: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ t: 'x', u: USER }))).toBeNull();
    expect(decodeRealtimeSignal('{"t":"u","u":"not-a-uuid"}')).toBeNull();
    expect(decodeRealtimeSignal('[1,2]')).toBeNull();
    expect(decodeRealtimeSignal('not json')).toBeNull();
  });

  it('writes one event per block with its data on a single line', () => {
    expect(encodeSseEvent('counts', { unread: 2, actionRequired: 1 })).toBe('event: counts\ndata: {"unread":2,"actionRequired":1}\n\n');
    expect(encodeSseEvent('notification', { title: 'Línea 1\nLínea 2' }, `1790000000000-${OTHER}`)).toBe(`id: 1790000000000-${OTHER}\nevent: notification\ndata: {"title":"Línea 1\\nLínea 2"}\n\n`);
    expect(encodeSseRetry(5000)).toBe('retry: 5000\n\n');
    expect(() => encodeSseEvent('bad name', {})).toThrow();
    expect(() => encodeSseEvent('counts', {}, 'a\nb')).toThrow();
    expect(SSE_HEADERS['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(SSE_HEADERS['cache-control']).toBe('no-cache, no-transform');
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  });

  it('round-trips the resume cursor and rejects anything else', () => {
    const at = new Date('2026-09-29T20:00:00.123Z');
    expect(parseEventCursor(formatEventCursor(at, OTHER))).toEqual({ at, id: OTHER });
    expect(parseEventCursor(` ${formatEventCursor(at, OTHER.toUpperCase())} `)).toEqual({ at, id: OTHER });
    expect(parseEventCursor('garbage')).toBeNull();
    expect(parseEventCursor(`abc-${OTHER}`)).toBeNull();
    expect(parseEventCursor(null)).toBeNull();
  });

  it('reads the realtime switches with their defaults', () => {
    const base = {
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
      AUDIT_CURSOR_SECRET: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=',
    };
    expect(readServerEnv(base)).toMatchObject({ REALTIME_ENABLED: true, REALTIME_HEARTBEAT_SECONDS: 25, REALTIME_SESSION_RECHECK_SECONDS: 60, REALTIME_MAX_CONNECTIONS_PER_USER: 10 });
    expect(readServerEnv({ ...base, REALTIME_ENABLED: 'false' }).REALTIME_ENABLED).toBe(false);
    expect(() => readServerEnv({ ...base, REALTIME_ENABLED: 'no' })).toThrow();
    expect(() => readServerEnv({ ...base, REALTIME_HEARTBEAT_SECONDS: '1' })).toThrow();
  });
});
