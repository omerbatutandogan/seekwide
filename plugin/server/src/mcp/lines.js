// Newline framing for the stdio transport: turns a byte stream into lines.

import { StringDecoder } from 'node:string_decoder';

/**
 * Split incoming chunks into lines. Multi-byte UTF-8 characters split across
 * chunks are reassembled. A line longer than `maxChars` is dropped up to its
 * newline and reported once through `onOverflow`, so one oversized message
 * cannot exhaust memory.
 *
 * @param {(line: string) => void} onLine  Receives each line without its "\n".
 * @param {() => void} onOverflow
 * @param {number} maxChars
 * @returns {{push(chunk: Buffer|string): void, end(): void}}
 */
export function createLineSplitter(onLine, onOverflow, maxChars) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let discarding = false;

  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (discarding) discarding = false;
        else onLine(line);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > maxChars) {
        buffer = '';
        if (!discarding) onOverflow();
        discarding = true;
      }
    },
    end() {
      const rest = buffer + decoder.end();
      buffer = '';
      if (!discarding && rest !== '') onLine(rest);
    },
  };
}
