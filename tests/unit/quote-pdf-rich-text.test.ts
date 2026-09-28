import { describe, expect, it } from 'vitest';
import { parseRichText } from '@/server/modules/quote-documents/rich-text';

describe('texto enriquecido de la cotización', () => {
  it('joins wrapped lines into paragraphs and splits on blank lines', () => {
    expect(parseRichText('Primera línea\ncontinúa aquí.\r\n\r\nSegundo párrafo.')).toEqual([
      { kind: 'paragraph', text: 'Primera línea continúa aquí.' },
      { kind: 'paragraph', text: 'Segundo párrafo.' },
    ]);
  });

  it('recognizes bullets, numbered items and headings', () => {
    expect(parseRichText('## 1. Objeto\n- Uno\n* Dos\n• Tres\n1. Anticipo\n2) Entrega\n#### Detalle')).toEqual([
      { kind: 'heading', level: 2, text: '1. Objeto' },
      { kind: 'bullet', marker: '•', text: 'Uno' },
      { kind: 'bullet', marker: '•', text: 'Dos' },
      { kind: 'bullet', marker: '•', text: 'Tres' },
      { kind: 'bullet', marker: '1.', text: 'Anticipo' },
      { kind: 'bullet', marker: '2.', text: 'Entrega' },
      { kind: 'heading', level: 3, text: 'Detalle' },
    ]);
  });

  it('continues an indented bullet and strips inline markdown', () => {
    expect(parseRichText('- Precio **fijo** con `válida hasta`\n  y ajustes [aquí](https://ocpool.com.mx)')).toEqual([
      { kind: 'bullet', marker: '•', text: 'Precio fijo con válida hasta y ajustes aquí (https://ocpool.com.mx)' },
    ]);
  });

  it('returns nothing for empty or null input and removes control characters', () => {
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText('   \n\n  ')).toEqual([]);
    expect(parseRichText('Hola\u0007 mundo')).toEqual([{ kind: 'paragraph', text: 'Hola mundo' }]);
  });
});
