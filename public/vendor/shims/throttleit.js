export default function throttle(fn, wait) {
  if (typeof fn !== "function") {
    throw new TypeError(`Expected a function, got ${typeof fn}.`);
  }

  let timeoutId = null;
  let lastCallTime = 0;

  return function throttled(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const now = Date.now();
    const remaining = Number(wait) - (now - lastCallTime);

    if (!Number.isFinite(remaining) || remaining <= 0) {
      lastCallTime = now;
      fn.apply(this, args);
      return;
    }

    timeoutId = setTimeout(() => {
      lastCallTime = Date.now();
      timeoutId = null;
      fn.apply(this, args);
    }, remaining);
  };
}
