// Minimal decoder for the AWS binary event stream protocol.
// Used by the harness invoke endpoint regardless of apiFormat setting.
// Spec: https://docs.aws.amazon.com/eventstream/latest/developer-guide/message-encoding.html

export interface EventStreamMessage {
  headers: Record<string, string>;
  payload: unknown; // parsed JSON
}

const textDecoder = new TextDecoder();

function u32(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function u16(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 8) | buf[offset + 1]) >>> 0;
}

function concat(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out as Uint8Array<ArrayBuffer>;
}

// Yields parsed messages from a streaming ReadableStream<Uint8Array>.
export async function* decodeEventStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
): AsyncGenerator<EventStreamMessage> {
  const reader = body.getReader();
  let buf = new Uint8Array(0) as Uint8Array<ArrayBuffer>;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = concat(buf, value);

      while (buf.length >= 12) {
        const totalLen = u32(buf, 0);
        if (buf.length < totalLen) break; // wait for rest of message

        const headersLen = u32(buf, 4);
        // bytes 8-11 are prelude CRC — skip
        let pos = 12;
        const headersEnd = pos + headersLen;
        const headers: Record<string, string> = {};

        while (pos < headersEnd) {
          const nameLen = buf[pos++];
          const name = textDecoder.decode(buf.subarray(pos, pos + nameLen));
          pos += nameLen;
          pos++; // header value type (7 = string)
          const valLen = u16(buf, pos);
          pos += 2;
          headers[name] = textDecoder.decode(buf.subarray(pos, pos + valLen));
          pos += valLen;
        }

        const payloadBytes = buf.subarray(12 + headersLen, totalLen - 4); // minus message CRC
        let payload: unknown = null;
        if (payloadBytes.length > 0) {
          try { payload = JSON.parse(textDecoder.decode(payloadBytes)); } catch { /* empty payload */ }
        }

        yield { headers, payload };
        buf = buf.subarray(totalLen);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
