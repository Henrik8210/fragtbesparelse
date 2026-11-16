export class MailTooLarge extends Error {}

export async function readMailBytes(raw: unknown): Promise<Uint8Array> {
  if (raw instanceof Uint8Array) return copyBytes(raw);
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw.slice(0));
  if (ArrayBuffer.isView(raw)) return copyBytes(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  // getReader() on the Cloudflare email byte stream throws after locking it.
  // That exception leaves email() before the PDF is posted. Response copies the bytes in the runtime.
  try {
    const buffered = await responseBytes(raw);
    if (buffered.byteLength > 0) return buffered;
  } catch (error) {
    if (error instanceof MailTooLarge) throw error;
  }
  const stream = streamOf(raw);
  if (!stream || stream.locked) throw new Error("invoice mail was not read");
  return readPipe(stream);
}

export function packMail(bytes: Uint8Array): string {
  return JSON.stringify({ v: 1, raw: encodeBase64(bytes) });
}

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const step = 0x1000;
  for (let index = 0; index < bytes.length; index += step) {
    const slice = bytes.subarray(index, Math.min(index + step, bytes.length));
    let binary = "";
    for (let cursor = 0; cursor < slice.length; cursor += 1) binary += String.fromCharCode(slice[cursor] ?? 0);
    parts.push(binary);
  }
  return btoa(parts.join(""));
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

async function readPipe(raw: ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const writable = new WritableStream({
    write(value: unknown) {
      const chunk = chunkBytes(value);
      size += chunk.byteLength;
      if (size > 8_000_000) throw new MailTooLarge();
      if (chunk.byteLength > 0) chunks.push(chunk);
    },
  });
  await raw.pipeTo(writable);
  return joinChunks(chunks, size);
}

function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  if (size === 0) throw new Error("invoice mail was not read");
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function streamOf(raw: unknown): ReadableStream | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof (raw as ReadableStream).getReader !== "function") return null;
  return raw as ReadableStream;
}

function copyBytes(value: Uint8Array): Uint8Array {
  const copy = new Uint8Array(value.byteLength);
  try {
    copy.set(value);
  } catch {
    for (let index = 0; index < value.byteLength; index += 1) copy[index] = value[index] ?? 0;
  }
  return copy;
}

function chunkBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return copyBytes(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return copyBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
  }
  return new Uint8Array();
}
