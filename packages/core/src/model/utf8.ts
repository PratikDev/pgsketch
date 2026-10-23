export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8 without splitting a character. */
export function clipUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let clipped = '';
  for (const char of text) {
    bytes += utf8Length(char);
    if (bytes > maxBytes) break;
    clipped += char;
  }
  return clipped;
}
