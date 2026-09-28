import { describe, expect, it } from 'vitest';
import { orderQuoteLines, orderQuoteSections } from '@/server/modules/quote-documents/snapshot-order';

describe('orden de la foto del PDF', () => {
  it('orders sections by position and lines by section, then position, loose lines last', () => {
    const sections = orderQuoteSections([
      { id: 'b', position: 1 },
      { id: 'a', position: 0 },
    ]);
    expect(sections.map((section) => section.id)).toEqual(['a', 'b']);

    const lines = orderQuoteLines([
      { id: '1', position: 0, sectionId: null },
      { id: '2', position: 1, sectionId: 'b' },
      { id: '3', position: 0, sectionId: 'b' },
      { id: '4', position: 5, sectionId: 'a' },
      { id: '5', position: 0, sectionId: 'missing' },
      { id: '6', position: 0, sectionId: 'a' },
    ], sections);
    expect(lines.map((line) => line.id)).toEqual(['6', '4', '3', '2', '1', '5']);
  });

  it('breaks ties by id so the order never depends on the database', () => {
    const lines = orderQuoteLines([{ id: 'z', position: 0, sectionId: null }, { id: 'y', position: 0, sectionId: null }], []);
    expect(lines.map((line) => line.id)).toEqual(['y', 'z']);
  });
});
