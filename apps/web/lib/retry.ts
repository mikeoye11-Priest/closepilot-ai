export async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<{ value: T; attempts: number }> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 10));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 150);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && baseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }

  throw lastError;
}
