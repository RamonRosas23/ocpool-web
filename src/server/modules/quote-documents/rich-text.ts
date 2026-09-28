/**
 * Texto libre de la cotización (alcance, condiciones, términos en Markdown) convertido en bloques que
 * el PDF sabe dibujar. No es un intérprete de Markdown completo: sólo lo que el equipo escribe de
 * verdad (títulos con #, listas con -, *, • o 1., **énfasis**, `código` y [enlaces](url)).
 */
export type RichTextBlock =
  | Readonly<{ kind: 'heading'; level: 1 | 2 | 3; text: string }>
  | Readonly<{ kind: 'paragraph'; text: string }>
  | Readonly<{ kind: 'bullet'; marker: string; text: string }>;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function cleanInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseRichText(input: string | null | undefined): RichTextBlock[] {
  const source = String(input ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(CONTROL_CHARACTERS, '');
  const blocks: RichTextBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = cleanInline(paragraph.join(' '));
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(3, heading[1]!.length) as 1 | 2 | 3, text: cleanInline(heading[2]!) });
      continue;
    }
    const bullet = /^[-*•·]\s+(.+)$/u.exec(line);
    const numbered = /^(\d{1,3})[.)]\s+(.+)$/u.exec(line);
    if (bullet || numbered) {
      flush();
      blocks.push({ kind: 'bullet', marker: numbered ? `${numbered[1]}.` : '•', text: cleanInline((numbered ? numbered[2] : bullet![1])!) });
      continue;
    }
    // Renglón sangrado justo después de una viñeta: continúa esa viñeta.
    const previous = blocks.at(-1);
    if (paragraph.length === 0 && /^\s{2,}/u.test(rawLine) && previous?.kind === 'bullet') {
      blocks[blocks.length - 1] = { ...previous, text: cleanInline(`${previous.text} ${line}`) };
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.filter((block) => block.text.length > 0);
}
