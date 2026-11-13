// Waiting that "stop" can always end.

/** The promise's result, or an AbortError as soon as `signal` aborts (whatever the promise is still waiting on). */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return aborted();
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => (signal.removeEventListener("abort", aborted), resolve(value)),
      (err: unknown) => (signal.removeEventListener("abort", aborted), reject(err)),
    );
  });
}
