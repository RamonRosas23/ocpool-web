import { describe, expect, it } from 'vitest';
import { changeRequestBody, changeRequestPrefix, parseChangeRequestBody } from '@/lib/change-request';

describe('change request messages', () => {
  it('round-trips what the customer asked for, per version', () => {
    const body = changeRequestBody(2, '  Azulejo color arena y LED.  ');
    expect(body.startsWith(changeRequestPrefix(2))).toBe(true);
    expect(parseChangeRequestBody(body, 2)).toBe('Azulejo color arena y LED.');
  });

  it('ignores ordinary messages and requests for another version', () => {
    expect(parseChangeRequestBody('¿Cuándo pueden venir?', 2)).toBeNull();
    expect(parseChangeRequestBody(changeRequestBody(1, 'Otro ajuste'), 2)).toBeNull();
  });
});
