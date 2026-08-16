export function restartDelayMs(consecutiveFailures) {
  if (consecutiveFailures <= 0) return 10_000;
  return Math.min(5_000 * (2 ** (consecutiveFailures - 1)), 60_000);
}

export async function watchProfiles(supervisor, {
  signal,
  onError = (error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
} = {}) {
  let failures = 0;
  while (!signal?.aborted) {
    try {
      await supervisor.ensure(['live', 'sandbox']);
      failures = 0;
    } catch (error) {
      failures += 1;
      onError(error);
    }
    await abortableDelay(restartDelayMs(failures), signal);
  }
}

function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
  });
}
