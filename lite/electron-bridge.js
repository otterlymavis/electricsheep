(function () {
  const clipboardCallbacks = [];
  const screenshotCallbacks = [];
  const bookmarkCallbacks = [];

  async function json(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  async function readClipboardText() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }

  async function readClipboardContent() {
    try {
      const items = await navigator.clipboard.read();
      let text = "";
      let html = "";
      for (const item of items) {
        if (item.types.includes("text/plain") && !text) {
          text = await (await item.getType("text/plain")).text();
        }
        if (item.types.includes("text/html") && !html) {
          html = await (await item.getType("text/html")).text();
        }
      }
      return { text, html };
    } catch {
      return { text: await readClipboardText(), html: "" };
    }
  }

  async function writeClipboardText(text) {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  }

  async function writeClipboardContent(content) {
    const text = String(content?.text || "");
    const html = String(content?.html || "");
    if (html && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" })
          })
        ]);
        return true;
      } catch {}
    }
    await writeClipboardText(text);
    return true;
  }

  function chooseFiles({ accept = "", multiple = false } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.multiple = multiple;
      input.style.display = "none";
      input.addEventListener("change", () => resolve([...input.files]));
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 1000);
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function saveBlobAttachment(blob, name) {
    return json("/api/attachment-data", {
      method: "POST",
      body: JSON.stringify({
        name,
        mime: blob.type,
        type: blob.type,
        base64: await blobToBase64(blob)
      })
    });
  }

  async function saveTextAttachment(file, text) {
    return json("/api/attachment-data", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        mime: file.type || "text/plain",
        type: "text",
        text
      })
    });
  }

  async function readClipboardImage() {
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith("image/"));
          if (!imageType) continue;
          return saveBlobAttachment(await item.getType(imageType), `clipboard-image-${Date.now()}.png`);
        }
      } catch {}
    }

    try {
      return await json("/api/clipboard-image", { method: "POST" });
    } catch {
      return null;
    }
  }

  async function importFiles() {
    const files = await chooseFiles({
      accept: ".txt,.md,.json,.log,.csv,.png,.jpg,.jpeg,.webp,text/*,image/*",
      multiple: true
    });
    const textParts = [];
    const attachments = [];

    for (const file of files) {
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        attachments.push(await saveBlobAttachment(file, file.name));
        continue;
      }

      const text = await file.text();
      textParts.push(`--- ${file.name} ---\n${text}`);
      attachments.push(await saveTextAttachment(file, text));
    }

    return {
      text: textParts.join("\n\n"),
      attachments
    };
  }

  async function importArchive() {
    const [file] = await chooseFiles({ accept: ".json,application/json" });
    if (!file) return null;
    const data = JSON.parse(await file.text());
    const result = await json("/api/import", {
      method: "POST",
      body: JSON.stringify(data)
    });
    return {
      addedBookmarks: result.added || 0,
      addedSessions: 0,
      restoredSessionFileCount: 0,
      restoredAttachmentFileCount: 0,
      warningCount: 0,
      skippedBookmarks: 0,
      skippedSessions: 0
    };
  }

  window.electricSheep = {
    readClipboardText,
    readClipboardContent,
    writeClipboardText,
    writeClipboardContent,
    readClipboardImage,
    captureScreenshot: () => json("/api/screenshot", { method: "POST" }),
    importFiles,
    exportArchive: () => json("/api/export", { method: "POST" }),
    importArchive,
    listBookmarks: () => json("/api/bookmarks").then((data) => data.bookmarks || []),
    listSessions: () => json("/api/sessions").then((data) => data.sessions || []),
    listActiveTracks: () => json("/api/tracks").then((data) => data.tracks || []),
    startTrackedSession: (options) => json("/api/tracks", {
      method: "POST",
      body: JSON.stringify(options || {})
    }),
    stopTrackedSession: (id) => json(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    searchArchive: (query) => json(`/api/search?q=${encodeURIComponent(query || "")}`).then((data) => data.results || []),
    readSessionFile: (filePath) => json("/api/read-file", {
      method: "POST",
      body: JSON.stringify({ path: filePath })
    }).then((data) => data.content || ""),
    addBookmark: (bookmark) => json("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(bookmark || {})
    }),
    deleteBookmark: (id) => json(`/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" }).then((data) => data.bookmarks || []),
    deleteSession: (id) => json(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).then((data) => data.sessions || []),
    getInfo: () => json("/api/info").then((info) => ({
      version: info.version || "0.1.0-lamb",
      storePath: info.storePath || ""
    })),
    ocrBackfill: () => json("/api/ocr-backfill", { method: "POST" }),
    doctorCheck: () => json("/api/doctor").then((data) => data.checks || []),
    repairLegacySessions: () => json("/api/repair-legacy", { method: "POST" }),
    onClipboardCaptured: (callback) => {
      if (typeof callback === "function") clipboardCallbacks.push(callback);
    },
    onScreenshotCaptured: (callback) => {
      if (typeof callback === "function") screenshotCallbacks.push(callback);
    },
    onBookmarkAdded: (callback) => {
      if (typeof callback === "function") bookmarkCallbacks.push(callback);
    },
    __emitClipboardCaptured: (content) => {
      for (const callback of clipboardCallbacks) callback(content);
    },
    __emitScreenshotCaptured: (screenshot) => {
      for (const callback of screenshotCallbacks) callback(screenshot);
    },
    __emitBookmarkAdded: (bookmark) => {
      for (const callback of bookmarkCallbacks) callback(bookmark);
    }
  };

  document.documentElement.dataset.lambBridge = "ready";
})();
