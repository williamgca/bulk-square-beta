function readFileEntry(entry) {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });
}

function readDirectoryBatch(reader) {
  return new Promise((resolve) => {
    reader.readEntries(resolve, () => resolve([]));
  });
}

async function readAllDirectoryEntries(entry) {
  const reader = entry.createReader();
  const entries = [];

  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (!batch.length) break;
    entries.push(...batch);
  }

  return entries;
}

async function collectEntryFiles(entry, files) {
  if (!entry) return;

  if (entry.isFile) {
    const file = await readFileEntry(entry);
    if (file) files.push(file);
    return;
  }

  if (!entry.isDirectory) return;

  const entries = await readAllDirectoryEntries(entry);
  for (const child of entries) {
    await collectEntryFiles(child, files);
  }
}

export async function collectDroppedFiles(dataTransfer) {
  if (!dataTransfer) return [];

  const fallbackFiles = Array.from(dataTransfer.files || []);
  const items = Array.from(dataTransfer.items || []);
  if (!items.length) return fallbackFiles;

  const sources = [];
  const files = [];
  let usedEntries = false;

  for (const item of items) {
    if (item.kind !== "file") continue;

    const entry = typeof item.webkitGetAsEntry === "function"
      ? item.webkitGetAsEntry()
      : null;

    if (entry) {
      usedEntries = true;
      sources.push({ entry });
    } else {
      const file = item.getAsFile();
      if (file) sources.push({ file });
    }
  }

  for (const source of sources) {
    if (source.entry) await collectEntryFiles(source.entry, files);
    else if (source.file) files.push(source.file);
  }

  if (usedEntries || files.length) return files;
  return fallbackFiles;
}
