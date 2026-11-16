export class ApiError extends Error {
  code: string;

  constructor(code: string, detail?: string) {
    super(detail && detail !== code ? detail : code);
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  if (!response.ok) {
    const code = body && typeof body.error === "string" ? body.error : "error";
    const detail = body && typeof body.message === "string" ? body.message : "";
    throw new ApiError(code, detail);
  }
  return body as T;
}
