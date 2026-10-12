(function () {
  "use strict";
  window.createDirectorySaver = function () {
    let directory = null, active = null;
    const groups = new Map();
    const supported = () => window.isSecureContext && typeof window.showDirectoryPicker === "function" && typeof ReadableStream !== "undefined";
    // Called synchronously by a click, before health/network awaits.
    function choose() {
      if (!supported()) return Promise.reject(new Error("Este navegador no permite guardar en una carpeta. Elegí Manual o ZIP."));
      return window.showDirectoryPicker({ mode: "readwrite", id: "playlist-downloads" }).then(handle => { directory = handle; groups.clear(); })
        .catch(error => {
          if (error?.name === "SecurityError") throw new Error("El navegador no permitió abrir la carpeta desde ese clic. Pulsá Preparar selección directamente; también podés usar Manual o ZIP.");
          if (error?.name === "NotAllowedError") throw new Error("El navegador denegó el permiso de la carpeta. Autorizala desde el navegador o elegí Manual o ZIP.");
          if (error?.name === "NotSupportedError") throw new Error("Este navegador no permite seleccionar carpetas. Elegí Manual o ZIP.");
          throw new Error("No se autorizó la carpeta. Podés elegir Manual o ZIP.");
        });
    }
    async function unused(parent, name, type) {
      try {
        if (type === "directory") await parent.getDirectoryHandle(name);
        else await parent.getFileHandle(name);
        return false;
      } catch (error) { if (error.name === "NotFoundError") return true; throw error; }
    }
    async function save(batchId, item, ticket, url) {
      if (!directory || active) throw new Error("Elegí una carpeta con permiso de escritura para continuar.");
      const controller = new AbortController(); active = controller;
      let parent, name, writable, created = false, saved = false;
      const timer = setTimeout(() => controller.abort(), 120000);
      const aborted = new Promise((resolve, reject) => {
        if (controller.signal.aborted) reject(new Error("cancelled"));
        else controller.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
      aborted.catch(() => {});
      const checked = promise => Promise.race([promise, aborted]);
      try {
        if (await checked(directory.queryPermission({ mode: "readwrite" })) !== "granted") throw new Error("permission");
        parent = groups.get(batchId);
        if (!parent) {
          const folderName = `Lista-${batchId}-${crypto.randomUUID()}`;
          if (!await checked(unused(directory, folderName, "directory"))) throw new Error("collision");
          parent = await checked(directory.getDirectoryHandle(folderName, { create: true })); groups.set(batchId, parent);
        }
        const filename = String(ticket.filename || item.filename || "descarga.mp3").normalize("NFKC")
          .replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}\\/:*?<>|"]/gu, "_").replace(/[. ]+$/g, "");
        const ext = filename.endsWith(".mp4") ? ".mp4" : ".mp3";
        name = `${String(item.position).padStart(4, "0")} - ${Array.from(filename.replace(/\.(mp3|mp4)$/i, "")).slice(0, 80).join("")} - ${crypto.randomUUID()}${ext}`;
        if (!await checked(unused(parent, name, "file"))) throw new Error("collision");
        const file = await checked(parent.getFileHandle(name, { create: true })); created = true;
        // Never buffer the entire body; await each bounded chunk under backpressure.
        writable = await checked(file.createWritable({ keepExistingData: false }));
        const response = await checked(fetch(url, { credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal }));
        const size = Number(response.headers.get("content-length"));
        if (!response.ok || !response.body || !Number.isSafeInteger(size) || size < 8 || !["audio/mpeg", "video/mp4"].includes(response.headers.get("content-type"))) throw new Error("transfer");
        const reader = response.body.getReader(); let received = 0;
        try {
          for (;;) {
            const chunk = await checked(reader.read()); if (chunk.done) break;
            received += chunk.value.byteLength;
            if (received > size) throw new Error("size");
            await checked(writable.write(chunk.value));
          }
          if (received !== size) throw new Error("size");
        } finally { reader.releaseLock(); }
        await checked(writable.close()); saved = true;
        return { jobId: item.jobId, deliveryId: ticket.deliveryId };
      } catch {
        controller.abort();
        try { await writable?.abort(); } catch { /* already closed/permission lost */ }
        if (created && !saved) { try { await parent.removeEntry(name); } catch { /* never remove another/pre-existing file */ } }
        throw new Error("No se pudo terminar el guardado. La tanda está pausada; comprobá el permiso y el espacio de la carpeta.");
      } finally { clearTimeout(timer); active = null; }
    }
    return { supported, choose, save, get authorized() { return Boolean(directory); }, abort() { active?.abort(); },
      leave() { active?.abort(); directory = null; groups.clear(); } };
  };
})();
