export function createStatusView(statusEl) {
  const TOAST_DURATION_MS = 2000;
  const TOAST_FADE_MS = 220;
  let hideTimer = null;
  let clearTimer = null;

  function clearTimers() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
  }

  function hideNow() {
    clearTimers();
    statusEl.textContent = "";
    statusEl.classList.remove("error", "ok", "is-visible", "is-hiding");
  }

  function setStatus(message, type) {
    if (!message) {
      hideNow();
      return;
    }

    clearTimers();
    statusEl.textContent = message;
    statusEl.classList.remove("error", "ok", "is-visible", "is-hiding");
    if (type) statusEl.classList.add(type);
    void statusEl.offsetWidth;
    statusEl.classList.add("is-visible");

    hideTimer = setTimeout(() => {
      statusEl.classList.remove("is-visible");
      statusEl.classList.add("is-hiding");
      clearTimer = setTimeout(() => {
        hideNow();
      }, TOAST_FADE_MS);
    }, TOAST_DURATION_MS);
  }

  return {
    setStatus
  };
}
