/**
 * Reliable CSV download for normal browsers, iframes, and sandboxed previews.
 */

export type DownloadResult =
  | { ok: true; method: "picker" | "anchor" | "msSave" | "open" }
  | { ok: false; reason: string; content: string; filename: string };

function sanitizeFilename(name: string): string {
  const base = (name || "letterboxd-import.csv").replace(/[^\w.\- ()[\]]+/g, "_");
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

function buildBlob(content: string): Blob {
  // UTF-8 BOM for Excel; Letterboxd accepts UTF-8
  return new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
}

/** File System Access API (Chrome/Edge) — most reliable when available */
async function saveWithPicker(blob: Blob, filename: string): Promise<boolean> {
  const w = window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof w.showSaveFilePicker !== "function") return false;

  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "CSV file",
          accept: { "text/csv": [".csv"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (err) {
    // User cancelled
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    return false;
  }
}

function clickDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.position = "fixed";
  a.style.left = "-9999px";
  a.style.top = "0";
  document.body.appendChild(a);

  // Synchronous click in the user-gesture stack
  a.click();

  // Keep node briefly so the browser can start the download
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      /* noop */
    }
  }, 2000);
}

/**
 * Trigger a CSV file download. Must be called from a click handler.
 */
export async function downloadCsvFile(
  content: string,
  filename = "letterboxd-import.csv"
): Promise<DownloadResult> {
  const finalName = sanitizeFilename(filename);
  const blob = buildBlob(content);

  // 1) Legacy Edge/IE
  const nav = window.navigator as Navigator & {
    msSaveOrOpenBlob?: (b: Blob, n: string) => boolean;
  };
  if (typeof nav.msSaveOrOpenBlob === "function") {
    try {
      nav.msSaveOrOpenBlob(blob, finalName);
      return { ok: true, method: "msSave" };
    } catch {
      /* continue */
    }
  }

  // 2) Save picker (best UX, works when downloads are restricted)
  try {
    const picked = await saveWithPicker(blob, finalName);
    if (picked) return { ok: true, method: "picker" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, reason: "cancelled", content, filename: finalName };
    }
  }

  // 3) Object URL + <a download>
  try {
    const url = URL.createObjectURL(blob);
    clickDownload(url, finalName);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, method: "anchor" };
  } catch {
    /* continue */
  }

  // 4) Data URI (small files only — large ones break URL length limits)
  try {
    if (content.length < 200_000) {
      const dataUri =
        "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + content);
      clickDownload(dataUri, finalName);
      return { ok: true, method: "anchor" };
    }
  } catch {
    /* continue */
  }

  // 5) Open blob in new tab as last automatic attempt
  try {
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (opened) return { ok: true, method: "open" };
  } catch {
    /* continue */
  }

  return {
    ok: false,
    reason: "blocked",
    content,
    filename: finalName,
  };
}

/** Create an object URL for a manual "right-click save" link */
export function createCsvObjectUrl(content: string): string {
  return URL.createObjectURL(buildBlob(content));
}
