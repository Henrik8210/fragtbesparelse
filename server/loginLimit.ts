const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

type Bucket = { fails: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function bucket(key: string, now: number): Bucket {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { fails: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return fresh;
  }
  return current;
}

export function loginBlocked(key: string, now = Date.now()): boolean {
  const current = buckets.get(key);
  return Boolean(current && current.resetAt > now && current.fails >= MAX_FAILS);
}

export function loginFailed(key: string, now = Date.now()): void {
  if (buckets.size > 5000) {
    for (const [name, item] of buckets) {
      if (item.resetAt <= now) buckets.delete(name);
    }
  }
  bucket(key, now).fails += 1;
}

export function loginSucceeded(key: string): void {
  buckets.delete(key);
}
