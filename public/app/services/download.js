export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10 * 60 * 1000);
}

export async function downloadBlobFromUrl(url, filename) {
  const downloadUrl = `/api/blob/download?url=${encodeURIComponent(url)}${filename ? `&filename=${encodeURIComponent(filename)}` : ""}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Error ${response.status}`);
  }

  return response.blob();
}
