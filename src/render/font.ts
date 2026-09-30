// A tiny 3x5 pixel font for in-world shouts ("AAH", "BLEH").
const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  ' ': ['...', '...', '...', '...', '...'],
};

export function textWidth(text: string): number {
  return text.length * 4 - 1;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, outline: string): void {
  x = Math.round(x);
  y = Math.round(y);
  const plot = (ox: number, oy: number, c: string) => {
    ctx.fillStyle = c;
    for (let i = 0; i < text.length; i++) {
      const g = GLYPHS[text[i].toUpperCase()] ?? GLYPHS['?'];
      for (let r = 0; r < 5; r++)
        for (let col = 0; col < 3; col++) if (g[r][col] === '#') ctx.fillRect(x + ox + i * 4 + col, y + oy + r, 1, 1);
    }
  };
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) plot(ox, oy, outline);
  plot(0, 0, color);
}
