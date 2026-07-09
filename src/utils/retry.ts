const TRANSIENT_PATTERNS = [
  /socket disconnected/i,
  /secure tls connection/i,
  /econnreset/i,
  /etimedout/i,
  /econnrefused/i,
  /network/i,
  /timeout/i,
  /fetch failed/i,
  /server selection timed out/i,
];

export function isTransientNetworkError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : '';
  if (!message) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; delayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isTransientNetworkError(err)) throw err;
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}
