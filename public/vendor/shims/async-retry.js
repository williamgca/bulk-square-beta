export default function retry(fn, options = {}) {
  const retries = Number.isFinite(options.retries) ? Math.max(0, Math.floor(options.retries)) : 0;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;

  return new Promise((resolve, reject) => {
    const run = async (attemptNumber) => {
      let bailed = false;

      const bail = (error) => {
        bailed = true;
        reject(error || new Error("Aborted"));
      };

      try {
        const result = await fn(bail, attemptNumber);
        if (!bailed) resolve(result);
      } catch (error) {
        if (bailed) return;

        if (attemptNumber > retries) {
          reject(error);
          return;
        }

        if (onRetry) onRetry(error, attemptNumber);
        queueMicrotask(() => {
          run(attemptNumber + 1);
        });
      }
    };

    run(1);
  });
}
