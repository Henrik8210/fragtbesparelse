export type MailFileLoad = {
  blob: Blob | null;
  promise: Promise<Blob>;
  loaded: number;
  total: number;
  subscribe: (listener: () => void) => () => void;
};

const KEEP = 8;
const loads = new Map<string, MailFileLoad>();

export function loadMailFile(fileId: string, companyId: string): MailFileLoad {
  const key = `${companyId}\n${fileId}`;
  const hit = loads.get(key);
  if (hit) {
    loads.delete(key);
    loads.set(key, hit);
    return hit;
  }
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const load: MailFileLoad = {
    blob: null,
    loaded: 0,
    total: 0,
    promise: Promise.resolve(new Blob()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  load.promise = (async () => {
    const response = await fetch(
      `/api/invoice-mail/files/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) throw new Error(`file ${response.status}`);
    const type = response.headers.get("content-type") ?? "application/octet-stream";
    load.total = Number(response.headers.get("x-file-size") || response.headers.get("content-length")) || 0;
    notify();
    if (!response.body) return new Blob([await response.arrayBuffer()], { type });
    const reader = response.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      load.loaded += value.byteLength;
      notify();
    }
    return new Blob(parts, { type });
  })().then(
    (blob) => {
      load.blob = blob;
      load.loaded = blob.size;
      load.total = blob.size;
      notify();
      return blob;
    },
    (error: unknown) => {
      loads.delete(key);
      notify();
      throw error;
    },
  );
  loads.set(key, load);
  while (loads.size > KEEP) {
    const oldest = loads.keys().next().value;
    if (oldest === undefined) break;
    loads.delete(oldest);
  }
  return load;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
