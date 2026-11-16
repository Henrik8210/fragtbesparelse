export class MailTooLarge extends Error {}

export async function readMailBytes(raw: unknown): Promise<Uint8Array> {
  if (raw instanceof Uint8Array) return raw.slice();
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice();
  const stream = streamOf(raw);
  if (!stream) return await responseBytes(raw);
  try {
    const buffered = await responseBytes(stream);
    if (buffered.byteLength > 0) return buffered;
  } catch (error) {
    if (error instanceof MailTooLarge) throw error;
  }
  if (stream.locked) throw new Error("invoice mail was not read");
  return readStream(stream);
}

export function limitMail(bytes: Uint8Array): Uint8Array | "large" {
  if (bytes.byteLength > 8_000_000) return "large";
  if (bytes.byteLength === 0) throw new Error("invoice mail was not read");
  return bytes;
}

export function headerField(value: string): string {
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  let safe = "";
  for (const char of flat) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) continue;
    safe += char;
  }
  const compact = safe.replace(/\s+/g, " ").trim().slice(0, 320);
  if (compact) return compact;
  const email = flat.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
  return email?.[0]?.slice(0, 320) ?? "";
}

async function responseBytes(raw: unknown): Promise<Uint8Array> {
  const buffered = new Uint8Array(await new Response(raw as BodyInit).arrayBuffer());
  if (buffered.byteLength > 8_000_000) throw new MailTooLarge();
  return buffered;
}

async function readStream(raw: ReadableStream): Promise<Uint8Array> {
  const reader = raw.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = chunkBytes(step.value);
    size += chunk.byteLength;
    if (size > 8_000_000) {
      await reader.cancel().catch(() => undefined);
      throw new MailTooLarge();
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (body.byteLength === 0) throw new Error("invoice mail was not read");
  return body;
}

function streamOf(raw: unknown): ReadableStream | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof (raw as ReadableStream).getReader !== "function") return null;
  return raw as ReadableStream;
}

function chunkBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
  }
  return new Uint8Array();
}
