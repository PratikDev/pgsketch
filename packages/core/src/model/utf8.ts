export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    // a character outside the BMP is a surrogate pair (two UTF-16 units) and takes 4 bytes
    const unit = char.charCodeAt(0);
    bytes += char.length === 2 ? 4 : unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
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
