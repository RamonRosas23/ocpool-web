import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUEST_PARTS as CLIENT_PARTS } from '@/lib/realtime-client';
import { REQUEST_SIGNAL_RULES, requestSignalFor } from '@/server/modules/inbox/realtime-signals';
import { decodeRealtimeSignal, encodeRealtimeSignal, REQUEST_PARTS } from '@/server/realtime/publish';

const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';
const CLIENT = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('request signals', () => {
  it('decodes only well-formed request signals', () => {
    const signal = { t: 'r', r: REQUEST, c: CLIENT, a: null, b: USER, p: ['messages', 'files'], v: 'C' } as const;
    expect(decodeRealtimeSignal(encodeRealtimeSignal(signal))).toEqual(signal);
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, a: USER, pa: USER, p: ['messages', 'nope', 'messages'] }))).toEqual({ ...signal, a: USER, pa: USER, p: ['messages'] });
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, p: ['nope'] }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, v: 'X' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, a: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, pa: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, c: undefined }))).toBeNull();
  });

  it('shares the list of parts with the browser', () => {
    expect([...CLIENT_PARTS]).toEqual([...REQUEST_PARTS]);
  });

  it('knows the parts and the visibility of each event', () => {
    const message = (visibility: string) => requestSignalFor({ eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: USER, payload: { quoteRequestId: REQUEST, visibility } });
    expect(message('CUSTOMER')).toEqual({ requestId: REQUEST, parts: ['messages'], visibility: 'C', previousAssigneeId: null });
    expect(message('INTERNAL')).toMatchObject({ visibility: 'I' });
    expect(requestSignalFor({ eventType: 'REQUEST.ASSIGNED', aggregateType: 'QUOTE_REQUEST', aggregateId: REQUEST, payload: { previousAssigneeId: USER } })).toEqual({ requestId: REQUEST, parts: ['assignment'], visibility: 'I', previousAssigneeId: USER });
    expect(requestSignalFor({ eventType: 'QUOTE.VERSION_REJECTED', aggregateType: 'QUOTE', aggregateId: USER, payload: { quoteRequestId: REQUEST, fromStatus: 'ENVIADA' } })).toMatchObject({ visibility: 'C' });
    expect(requestSignalFor({ eventType: 'QUOTE.VERSION_REJECTED', aggregateType: 'QUOTE', aggregateId: USER, payload: { quoteRequestId: REQUEST, fromStatus: 'EN_REVISION' } })).toMatchObject({ visibility: 'I' });
    expect(requestSignalFor({ eventType: 'QUOTE.VERSION_REOPENED', aggregateType: 'QUOTE', aggregateId: USER, payload: { quoteRequestId: REQUEST } })).toMatchObject({ parts: ['quote', 'approvals'], visibility: 'I' });
    expect(requestSignalFor({ eventType: 'PRICES.PENDING_RESOLVED', aggregateType: 'PRICE_LIST', aggregateId: USER, payload: {} })).toBeNull();
    expect(requestSignalFor({ eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: USER, payload: {} })).toBeNull();
    expect(requestSignalFor({ eventType: 'SOMETHING.NEW', aggregateType: 'QUOTE_REQUEST', aggregateId: REQUEST, payload: {} })).toBeNull();
  });

  it('covers every event type the server emits', () => {
    const emitted = new Set<string>();
    for (const file of sourceFiles(path.resolve('src/server'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'((?:AUTH|CATALOG|CONVERSATION|EMAIL|FILE|MESSAGE|PRICES|PROJECT|QUOTE|REQUEST|TEAM)\.[A-Z_]+)'/gu)) emitted.add(match[1]);
    }
    expect(emitted.size).toBeGreaterThan(30);
    const missing = [...emitted].filter((eventType) => !(eventType in REQUEST_SIGNAL_RULES));
    expect(missing).toEqual([]);
  });
});
