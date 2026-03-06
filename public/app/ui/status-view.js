export function createStatusView(statusEl) {
  function setStatus(message, type) {
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "ok");
    if (type) statusEl.classList.add(type);
  }

  return {
    setStatus
  };
}
