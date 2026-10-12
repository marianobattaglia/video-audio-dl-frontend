(function () {
  "use strict";
  window.createPlaylistController = function ({ request, readiness, access, apiOrigin, getKind, notify, abortRequests }) {
    const panel = document.querySelector("#playlist-panel"), heading = document.querySelector("#playlist-title");
    const message = document.querySelector("#playlist-message"), choices = document.querySelector("#playlist-choices");
    const count = document.querySelector("#playlist-count"), results = document.querySelector("#playlist-results");
    const startButton = document.querySelector("#playlist-start"), continueButton = document.querySelector("#playlist-continue");
    const cancelButton = document.querySelector("#playlist-cancel"), discardButton = document.querySelector("#playlist-discard");
    const navigation = document.querySelector("#playlist-navigation"), pageLabel = document.querySelector("#playlist-page");
    const previousButton = document.querySelector("#playlist-previous"), nextButton = document.querySelector("#playlist-next");
    const selectPageButton = document.querySelector("#playlist-select-page"), unselectPageButton = document.querySelector("#playlist-unselect-page");
    const modeSelect = document.querySelector("#playlist-mode"), modeHint = document.querySelector("#playlist-mode-hint");
    const pauseButton = document.querySelector("#playlist-pause"), folderButton = document.querySelector("#playlist-folder");
    const finalizeButton = document.querySelector("#playlist-finalize"), archiveLink = document.querySelector("#playlist-archive-link");
    const saver = window.createDirectorySaver?.();
    const localSaved = new Map();
    let consuming = false, closing = false, retryPlan = null, archiveTicket = null, archiveTicketPending = false, archiveDelivery = false, archiveDeliveryAt = 0;
    let revision = 0, previewData = null, batch = null, pending = false, driving = false, paused = true, dead = false;
    let timer = null, operation = false, lastUrl = "", cooldown = 0, pendingPage = null;
    const selected = new Set(), rows = new Map(), acknowledged = new Set();
    const uuid = () => crypto.randomUUID();
    const node = (tag, className, content) => { const value = document.createElement(tag); value.className = className || ""; if (content !== undefined) value.textContent = content; return value; };
    const current = value => !dead && revision === value;
    const mode = () => batch?.deliveryMode || modeSelect?.value || "manual";
    const automaticMode = () => Boolean(batch && mode() !== "manual");
    function validTicket(ticket, pathname) {
      const target = new URL(ticket.downloadUrl, apiOrigin + "/");
      if (target.origin !== apiOrigin || target.pathname !== pathname || target.username || target.password || target.hash
        || !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get("ticket") || "") || [...target.searchParams].length !== 1
        || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) throw new Error("No se pudo validar el enlace de descarga.");
      return target.href;
    }
    function status(value) { message.textContent = value; }
    function sync() {
      startButton.disabled = pending || operation || Boolean(batch) || !selected.size;
      startButton.hidden = !previewData || Boolean(batch);
      cancelButton.disabled = closing; cancelButton.hidden = !batch || batch.cancelled;
      continueButton.hidden = !paused || pending;
      continueButton.disabled = pending || operation || Date.now() < cooldown;
      discardButton.disabled = closing;
      navigation.hidden = !previewData || Boolean(batch);
      previousButton.disabled = pending || operation || !previewData?.previousPageToken;
      nextButton.disabled = pending || operation || !previewData?.nextPageToken;
      selectPageButton.disabled = unselectPageButton.disabled = pending || operation || Boolean(batch);
      if (modeSelect) modeSelect.disabled = pending || operation || Boolean(batch);
      if (pauseButton) { pauseButton.hidden = !automaticMode() || paused || batch.cancelled; pauseButton.disabled = false; }
      if (folderButton) { folderButton.hidden = !batch || mode() !== "automatic" || !paused; folderButton.disabled = pending || operation; }
      if (finalizeButton) { finalizeButton.hidden = !batch || mode() !== "zip" || !batch.archive?.included || ["ready", "partial_ready", "expired"].includes(batch.archive.state); finalizeButton.disabled = pending || operation || consuming; }
      notify();
    }
    function schedule() {
      clearTimeout(timer);
      if (retryPlan && !paused && !dead) { timer = setTimeout(() => refresh().catch(showError), Math.max(1, retryPlan.at - Date.now())); return; }
      if (batch && !dead && !consuming && (batch.entries.some(item => ["pending", "starting", "queued", "running", "ready", "delivering", "transferring", "awaiting_save_confirmation", "archiving"].includes(item.status))
        || mode() === "zip" && ((!paused && batch.archive?.included && batch.archive.state === "building") || archiveDelivery && Date.now() - archiveDeliveryAt < 120000))) timer = setTimeout(() => refresh().catch(showError), 1200);
    }
    function showError(error) {
      paused = true;
      if ([404, 410].includes(error.status) && batch) { clearTimeout(timer); status(localSaved.size ? "Los archivos ya guardados siguen en tu carpeta, pero el backend perdió la tanda. No se guardarán otra vez. Cargá la lista nuevamente." : "La tanda se interrumpió o venció. Cargá la lista nuevamente."); }
      else if (error.status === 404 && !batch) status("Este backend todavía no admite listas. Podés pegar el enlace de una canción individual.");
      else status(error.message || "No pudimos confirmar la operación. Comprobá el estado antes de continuar.");
      if (error.retryAfter) { cooldown = Date.now() + error.retryAfter * 1000; clearTimeout(timer); const rev = revision; timer = setTimeout(() => { if (current(rev)) sync(); }, error.retryAfter * 1000); }
      sync();
    }
    function renderChoices(data) {
      choices.replaceChildren(); results.replaceChildren(); rows.clear();
      for (const item of data.entries) {
        const li = node("li", "playlist-choice"), label = node("label", "playlist-choice-label");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.disabled = !item.available;
        checkbox.checked = selected.has(item.id);
        const copy = node("span", "playlist-choice-copy");
        copy.append(node("strong", "", `${item.position}. ${item.title}`));
        copy.append(node("small", "", !item.available ? "No disponible" : item.duration == null ? "Duración no informada" : `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, "0")}`));
        label.append(checkbox, copy); li.append(label); choices.append(li);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked && data.limits.batchItems !== null && selected.size >= data.limits.batchItems) { checkbox.checked = false; status(`Este backend permite hasta ${data.limits.batchItems} canciones por tanda.`); }
          else if (checkbox.checked) selected.add(item.id); else selected.delete(item.id);
          updateCount(); sync();
        });
      }
      updateCount(); pageLabel.textContent = `Página ${data.page || 1}`;
    }
    function updateCount() {
      count.textContent = previewData?.limits.batchItems === null ? `${selected.size} canciones seleccionadas` : `${selected.size} de ${previewData?.limits.batchItems} seleccionadas`;
    }
    function showPreview(data) {
      if (!Array.isArray(data.entries) || data.entries.length > 50 || !data.limits
        || data.limits.batchItems !== null && (!Number.isInteger(data.limits.batchItems) || data.limits.batchItems < 1 || data.limits.batchItems > 50)) throw new Error("La vista previa no es válida.");
      previewData = data; heading.textContent = data.title; renderChoices(data);
      if (modeSelect?.options) {
        const supported = data.limits.deliveryModes || ["manual"];
        for (const option of modeSelect.options) option.disabled = !supported.includes(option.value) || option.value === "automatic" && !saver?.supported();
        if (![...modeSelect.options].some(option => option.value === modeSelect.value && !option.disabled)) modeSelect.value = "manual";
        modeHint.textContent = !saver?.supported() ? "Para guardar automáticamente en una carpeta necesitás un navegador compatible, como Chrome de escritorio. Podés usar Manual o ZIP si están disponibles." : "Automático solicita una carpeta. ZIP reúne los resultados; puede ser parcial si alcanza los límites de espacio o tiempo.";
      }
      status(data.nextPageToken ? "Elegí canciones. Podés cargar más; tu selección se conserva entre páginas."
        : data.truncated ? "Este backend muestra solo una parte de la lista. Podés seleccionar las canciones disponibles."
        : !data.entries.some(item => item.available) ? "No hay canciones disponibles en esta página." : "Elegí las canciones y el formato de descarga.");
      paused = false; pendingPage = null;
    }
    async function loadPage(token) {
      if (pending || operation || dead || batch || !previewData || !token) return;
      const rev = revision, previewId = previewData.previewId; pendingPage = token; operation = true; pending = true; sync();
      try {
        if (!await allowed() || !current(rev)) { if (current(rev)) paused = true; return; }
        status("Consultando otra página; tu selección está guardada…");
        const data = await request("/api/playlists/preview", { method: "POST", body: { previewId, pageToken: token }, timeout: 60000 });
        if (!current(rev)) return;
        if (data.previewId !== previewId) throw new Error("La página no corresponde a esa lista.");
        showPreview(data);
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { pending = false; operation = false; sync(); } }
    }
    previousButton.addEventListener("click", () => loadPage(previewData?.previousPageToken));
    nextButton.addEventListener("click", () => loadPage(previewData?.nextPageToken));
    selectPageButton.addEventListener("click", () => {
      if (pending || operation || batch || !previewData) return;
      for (const item of previewData.entries) if (item.available && (previewData.limits.batchItems === null || selected.size < previewData.limits.batchItems)) selected.add(item.id);
      renderChoices(previewData); sync();
    });
    unselectPageButton.addEventListener("click", () => {
      if (pending || operation || batch || !previewData) return;
      for (const item of previewData.entries) selected.delete(item.id);
      renderChoices(previewData); sync();
    });
    function makeRow(item) {
      const li = node("li", "playlist-result"), title = node("strong", "playlist-result-title", `${item.position}. ${item.title}`);
      const detail = node("p", "playlist-result-detail"), progress = node("progress", "playlist-progress"); progress.max = 100;
      progress.setAttribute("aria-label", `Progreso de ${item.title}`);
      const actions = node("div", "playlist-row-actions"), link = node("a", "file-link", "Descargar archivo");
      link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer"; link.hidden = true;
      const retry = node("button", "cancel-button", "Preparar otra vez"); retry.type = "button"; retry.hidden = true;
      actions.append(link, retry); li.append(title, detail, progress, actions); results.append(li);
      const view = { li, detail, progress, link, retry, ticket: null, ticketPending: false, ticketError: false, deliveryAt: 0, jobId: null, item };
      rows.set(item.id, view);
      link.addEventListener("click", event => {
        if (pending || dead || view.ticketPending || view.deliveryAt) { event.preventDefault(); return; }
        if (!view.ticket || view.ticket.expiresAt <= Date.now() + 2000) { event.preventDefault(); void prepareTicket(view, true); return; }
        const rev = revision; view.deliveryAt = Date.now(); view.detail.textContent = "Se solicitó la entrega en tu navegador.";
        setTimeout(() => { if (current(rev)) { link.hidden = true; link.removeAttribute("href"); view.ticket = null; } }, 0);
        schedule();
      });
      retry.addEventListener("click", async () => {
        if (pending || operation || driving || !batch || dead) return;
        if (localSaved.has(view.item.id)) { status("Este archivo ya se guardó en tu carpeta. Comprobá el estado para confirmar; no se preparará otra copia."); return; }
        if (view.item.status === "ready") { view.deliveryAt = 0; await prepareTicket(view, true); return; }
        if (!["failed", "expired"].includes(view.item.status)) return;
        const rev = revision; operation = true; sync();
        try { if (await allowed() && current(rev)) { paused = true; await startEntry(view.item); } }
        catch (error) { if (current(rev)) showError(error); }
        finally { if (current(rev)) { operation = false; sync(); } }
      });
      return view;
    }
    async function prepareTicket(view, refreshed = false) {
      if (view.ticketPending || dead || view.item.status !== "ready" || view.deliveryAt) return;
      const rev = revision, jobId = view.item.jobId; view.ticketPending = true; view.ticketError = false;
      view.link.hidden = true; view.link.removeAttribute("href");
      try {
        const ticket = await request(`/api/jobs/${jobId}/ticket`, { method: "POST" });
        if (!current(rev) || view.item.jobId !== jobId || view.item.status !== "ready") return;
        const target = new URL(ticket.downloadUrl, apiOrigin + "/");
        if (target.origin !== apiOrigin || target.pathname !== `/api/jobs/${jobId}/file` || target.username || target.password || target.hash
          || !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get("ticket") || "") || [...target.searchParams].length !== 1
          || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) throw new Error("No se pudo validar el enlace de descarga.");
        view.ticket = { expiresAt: ticket.expiresAt }; view.link.href = target.href;
        view.link.download = ticket.filename || view.item.filename || "descarga"; view.link.hidden = false;
        if (refreshed) view.detail.textContent = "Enlace actualizado. Pulsá Descargar archivo nuevamente.";
      } catch (error) {
        if (current(rev)) { view.ticketError = true; view.detail.textContent = error.message; view.retry.textContent = "Volver a solicitar enlace"; view.retry.hidden = false; if (error.status === 401) showError(error); }
      } finally { view.ticketPending = false; }
    }
    function renderBatch(data) {
      batch = data; choices.hidden = true; count.hidden = true; results.hidden = false;
      let completed = 0;
      for (const item of data.entries) {
        const view = rows.get(item.id) || makeRow(item); view.item = item;
        if (view.jobId !== item.jobId) { view.jobId = item.jobId; view.ticket = null; view.ticketError = false; view.deliveryAt = 0; view.link.hidden = true; view.link.removeAttribute("href"); }
        view.progress.hidden = !["running", "queued", "starting"].includes(item.status); view.progress.value = item.progress || 0;
        view.retry.hidden = !["failed", "expired"].includes(item.status);
        view.retry.textContent = "Preparar otra vez";
        if (item.status === "ready" && mode() === "manual") {
          completed++;
          if (view.deliveryAt) {
            view.detail.textContent = "Esperando confirmación de la entrega…";
            if (Date.now() - view.deliveryAt >= 15000) { view.detail.textContent = "La entrega no comenzó. Podés volver a solicitar el enlace."; view.retry.textContent = "Volver a solicitar enlace"; view.retry.hidden = false; }
          } else if (view.ticketError) { view.retry.textContent = "Volver a solicitar enlace"; view.retry.hidden = false; }
          else { view.detail.textContent = item.filename || "Archivo listo"; if (!view.ticket && !view.ticketPending) void prepareTicket(view); }
        } else {
          view.detail.textContent = item.status === "pending" ? "Pendiente" : item.status === "delivering" ? "Entregando el archivo…" : item.message;
          view.link.hidden = true; view.link.removeAttribute("href"); view.ticket = null;
          if (["delivered", "saved", "archived", "failed", "expired", "cancelled"].includes(item.status)) { completed++; view.deliveryAt = 0; }
          if (localSaved.has(item.id) && item.status !== "saved") view.detail.textContent = "Guardado en tu carpeta; falta confirmar con el servidor.";
          if (item.status === "awaiting_save_confirmation" && !localSaved.has(item.id)) view.detail.textContent = "La transferencia terminó, pero el guardado no está confirmado. Comprobá el estado para reintentar.";
          if (item.status === "delivering" && view.deliveryAt && Date.now() - view.deliveryAt >= 120000) { paused = true; status("La entrega todavía no se confirmó. Usá Comprobar estado; no se solicitará otra automáticamente."); }
        }
        if (item.pauseOnFailure && !acknowledged.has(item.jobId)) { paused = true; status(item.message); }
      }
      heading.textContent = `${data.title} · ${completed}/${data.entries.length}`;
      if (data.cancelled) { paused = true; status("Tanda cancelada. Los archivos listos siguen disponibles hasta que venzan."); }
      else if (data.pauseReason === "ready_files") { paused = true; status("Guardá un archivo listo y después pulsá Continuar."); }
      else if (!paused) status(mode() === "zip" ? "Preparando y agregando canciones al paquete…" : mode() === "automatic" ? "Preparando y guardando una canción por vez…" : data.state === "complete" ? "Preparación finalizada. Guardá cada archivo disponible." : "Preparando las canciones seleccionadas…");
      if (mode() === "zip" && data.archive?.canDownload) {
        status(data.archive.state === "partial_ready" ? "ZIP parcial listo. Consultá resultado.txt para ver qué canciones se incluyeron." : "Tu ZIP está listo.");
        if (!archiveTicket && !archiveTicketPending && !archiveDelivery) void prepareArchiveTicket();
        if (archiveDelivery && Date.now() - archiveDeliveryAt >= 15000) { paused = true; status("La entrega del ZIP no comenzó. Pulsá Comprobar estado para solicitar el enlace nuevamente."); }
      }
      if (mode() === "zip" && data.archive?.included && !data.archive.canDownload && !data.archive.delivering) modeHint.textContent = "Finalizar parcial conserva las canciones ya agregadas y descarta las restantes de esta tanda.";
      if (mode() === "zip" && data.archive && !data.archive.canDownload) {
        archiveTicket = null; archiveLink.hidden = true; archiveLink.removeAttribute("href");
        if (data.archive.delivering) { status("Entregando el ZIP al navegador…"); if (Date.now() - archiveDeliveryAt >= 120000) { paused = true; status("La entrega no se confirmó. Comprobá el estado manualmente."); } }
        else if (data.archive.state === "expired") { archiveDelivery = false; status(data.archive.delivered ? "El ZIP fue entregado al navegador." : "El ZIP venció o la entrega se interrumpió."); }
      }
      if (mode() === "automatic" && data.entries.every(item => ["saved", "failed", "cancelled", "expired"].includes(item.status)) && !localSaved.size) status("Guardado finalizado. Revisá el resultado de cada canción.");
      continueButton.textContent = "Continuar / Comprobar estado"; sync();
    }
    async function allowed() {
      if (dead || Date.now() < cooldown || !access()) return false;
      return readiness();
    }
    async function startEntry(item, attemptId = uuid()) {
      if (pending || dead) return;
      const rev = revision, id = batch.id; pending = true; sync();
      try {
        await request(`/api/playlist-batches/${id}/items/${item.id}/start`, { method: "POST", body: { attemptId }, timeout: 30000 });
        retryPlan = null;
        if (!current(rev)) return;
        const data = await request(`/api/playlist-batches/${id}`);
        if (current(rev)) renderBatch(data);
      } catch (error) {
        if (current(rev)) {
          const count = retryPlan?.itemId === item.id ? retryPlan.count : 0;
          if (automaticMode() && !paused && error.code === "E_MEDIA_ADMISSION_RATE" && Number.isFinite(error.retryAfter) && error.retryAfter > 0 && error.retryAfter <= 3600 && count < 2) {
            retryPlan = { itemId: item.id, attemptId, count: count + 1, at: Date.now() + error.retryAfter * 1000 };
            status("Esperando la ventana de preparación del servidor. Podés pausar o cancelar.");
          } else { retryPlan = null; showError(error); }
        }
      }
      finally { if (current(rev)) { pending = false; sync(); schedule(); } }
    }
    async function drive() {
      if (driving || pending || paused || dead || !batch || batch.cancelled) return;
      if (batch.entries.some(item => ["starting", "queued", "running"].includes(item.status))) return;
      if (retryPlan) {
        if (Date.now() < retryPlan.at) return;
        const item = batch.entries.find(entry => entry.id === retryPlan.itemId);
        if (item?.status === "pending") { driving = true; try { await startEntry(item, retryPlan.attemptId); } finally { driving = false; } }
        return;
      }
      if (automaticMode()) {
        const ready = batch.entries.find(item => ["ready", "awaiting_save_confirmation"].includes(item.status) || localSaved.has(item.id) && item.status !== "saved");
        if (ready) { await consume(ready); return; }
        if (batch.entries.some(item => ["transferring", "archiving"].includes(item.status))) return;
      }
      const next = batch.entries.find(item => item.status === "pending");
      if (!next) {
        if (mode() === "zip" && batch.archive?.included && batch.archive.state === "building"
          && batch.entries.every(item => item.status === "archived" || item.status === "failed" && !item.pauseOnFailure)) await finalizeArchive(true);
        return;
      }
      if (batch.readyCount >= batch.limits.readyFiles) { paused = true; status("Guardá un archivo listo antes de continuar."); sync(); return; }
      driving = true; const rev = revision;
      try { await startEntry(next); } finally { if (current(rev)) driving = false; }
    }
    async function refresh() {
      if (!batch || dead || pending || operation) { schedule(); return; }
      const rev = revision, id = batch.id;
      try {
        const data = await request(`/api/playlist-batches/${id}`);
        if (!current(rev)) return;
        renderBatch(data); await drive();
        if (current(rev)) schedule();
      } catch (error) { if (current(rev)) { clearTimeout(timer); showError(error); } }
    }
    async function preview(url) {
      if (pending || dead) return;
      const rev = ++revision; lastUrl = url; previewData = null; pendingPage = null; batch = null; pending = true; paused = true;
      clearTimeout(timer); retryPlan = null; localSaved.clear(); saver?.leave(); archiveTicket = null; archiveTicketPending = false; archiveDelivery = false; consuming = false; driving = false; closing = false;
      if (archiveLink) { archiveLink.hidden = true; archiveLink.removeAttribute("href"); }
      selected.clear(); rows.clear(); acknowledged.clear();
      panel.hidden = false; choices.hidden = false; count.hidden = false; results.hidden = true;
      choices.replaceChildren(); results.replaceChildren(); heading.textContent = "Leyendo la lista";
      status("Consultando canciones, sin preparar archivos…"); sync();
      try {
        const data = await request("/api/playlists/preview", { method: "POST", body: { url }, timeout: 60000 });
        if (!current(rev)) return;
        showPreview(data);
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { pending = false; sync(); } }
    }
    startButton.addEventListener("click", async () => {
      if (pending || operation || batch || !previewData || !selected.size) return;
      const rev = revision; operation = true; sync();
      try {
        // Directory picker must be the first awaited action from this user click.
        const deliveryMode = mode();
        if (deliveryMode === "automatic") await saver.choose();
        if (!await allowed() || !current(rev)) return;
        pending = true; sync();
        const body = { previewId: previewData.previewId, entryIds: [...selected], kind: getKind() };
        if (previewData.limits.deliveryModes) body.deliveryMode = deliveryMode;
        const data = await request("/api/playlist-batches", { method: "POST", body });
        if (!current(rev)) return;
        pending = false; paused = false; renderBatch(data); await drive(); schedule();
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { pending = false; operation = false; sync(); } }
    });
    continueButton.addEventListener("click", async () => {
      if (pending || operation || dead) return;
      const rev = revision; operation = true; sync();
      try {
        if (!batch && pendingPage) { const token = pendingPage; operation = false; await loadPage(token); return; }
        if (!await allowed() || !current(rev)) return;
        if (!batch) { operation = false; await preview(lastUrl); return; }
        const data = await request(`/api/playlist-batches/${batch.id}`);
        if (!current(rev)) return;
        if (archiveDelivery && data.archive?.canDownload && Date.now() - archiveDeliveryAt >= 15000) { archiveDelivery = false; archiveTicket = null; }
        for (const item of data.entries) if (item.status === "failed") acknowledged.add(item.jobId);
        paused = false; renderBatch(data); await drive(); schedule();
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { operation = false; sync(); } }
    });
    cancelButton.addEventListener("click", async () => {
      if (closing || !batch) return;
      closing = true; consuming = false; driving = false;
      saver?.abort(); retryPlan = null; clearTimeout(timer);
      const rev = ++revision; abortRequests(); pending = false; operation = true; paused = true; sync();
      try { const data = await request(`/api/playlist-batches/${batch.id}`, { method: "DELETE" }); if (current(rev)) { renderBatch(data); schedule(); } }
      catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { operation = false; closing = false; sync(); } }
    });
    discardButton.addEventListener("click", async () => {
      if (closing) return;
      closing = true; consuming = false; driving = false;
      ++revision; clearTimeout(timer); paused = true; retryPlan = null; saver?.abort(); abortRequests();
      const old = batch; operation = true; sync();
      try { if (old) await request(`/api/playlist-batches/${old.id}?discard=true`, { method: "DELETE" }); }
      catch (error) { if (![404, 410].includes(error.status)) { status(error.message); pending = false; operation = false; closing = false; sync(); return; } }
      previewData = null; pendingPage = null; batch = null; pending = false; operation = false; rows.clear(); selected.clear();
      saver?.leave(); localSaved.clear(); archiveTicket = null; if (archiveLink) { archiveLink.hidden = true; archiveLink.removeAttribute("href"); }
      panel.hidden = true; closing = false; sync();
    });
    async function consume(item) {
      if (consuming || pending || paused || dead) return;
      const rev = revision, id = batch.id; consuming = true; pending = true; clearTimeout(timer); sync();
      try {
        if (mode() === "automatic") {
          let confirmation = localSaved.get(item.id);
          if (!confirmation) {
            const path = `/api/playlist-batches/${id}/items/${item.id}`;
            const ticket = await request(path + "/transfer-ticket", { method: "POST", body: { jobId: item.jobId } });
            if (!current(rev)) return;
            if (!/^[0-9a-f-]{36}$/i.test(ticket.deliveryId || "")) throw new Error("No se pudo validar la transferencia.");
            const url = validTicket(ticket, path + "/file");
            status(`Guardando ${item.position}. ${item.title}…`);
            confirmation = await saver.save(id, item, ticket, url);
            if (!current(rev)) return;
            localSaved.set(item.id, confirmation);
            rows.get(item.id).detail.textContent = "Guardado en tu carpeta. Confirmando…";
          }
          await request(`/api/playlist-batches/${id}/items/${item.id}/save-confirmation`, { method: "POST", body: confirmation });
          if (!current(rev)) return;
          localSaved.delete(item.id);
        } else {
          status(`Agregando ${item.position}. ${item.title} al ZIP…`);
          await request(`/api/playlist-batches/${id}/archive/append`, { method: "POST",
            body: { entryId: item.id, jobId: item.jobId, attemptId: item.attemptId }, timeout: 125000 });
        }
        if (!current(rev)) return;
        const data = await request(`/api/playlist-batches/${id}`);
        if (current(rev)) renderBatch(data);
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { consuming = false; pending = false; sync(); schedule(); } }
    }
    async function finalizeArchive(allowPartial) {
      if (pending || dead || mode() !== "zip") return;
      const rev = revision; pending = true; consuming = true; clearTimeout(timer); sync();
      try {
        const data = await request(`/api/playlist-batches/${batch.id}/archive/finalize`, { method: "POST", body: { allowPartial }, timeout: 125000 });
        if (current(rev)) { paused = true; renderBatch(data); }
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { consuming = false; pending = false; sync(); } }
    }
    async function prepareArchiveTicket() {
      if (archiveTicketPending || dead || !batch?.archive?.canDownload) return;
      const rev = revision, id = batch.id; archiveTicketPending = true;
      archiveLink.hidden = true; archiveLink.removeAttribute("href");
      try {
        const ticket = await request(`/api/playlist-batches/${id}/archive/ticket`, { method: "POST", body: {} });
        if (!current(rev)) return;
        archiveLink.href = validTicket(ticket, `/api/playlist-batches/${id}/archive/file`);
        archiveLink.download = ticket.filename || "lista.zip"; archiveLink.hidden = false; archiveTicket = ticket;
      } catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) archiveTicketPending = false; }
    }
    archiveLink?.addEventListener("click", event => {
      if (dead || archiveDelivery || archiveTicketPending) { event.preventDefault(); return; }
      if (!archiveTicket || archiveTicket.expiresAt <= Date.now() + 2000) {
        event.preventDefault(); archiveTicket = null; status("Actualizando el enlace. Pulsá Descargar ZIP nuevamente."); void prepareArchiveTicket(); return;
      }
      archiveDelivery = true; archiveDeliveryAt = Date.now(); status("Se solicitó la entrega del ZIP en tu navegador."); schedule();
      const rev = revision; setTimeout(() => { if (current(rev)) { archiveLink.hidden = true; archiveLink.removeAttribute("href"); } }, 0);
    });
    pauseButton?.addEventListener("click", () => {
      paused = true; retryPlan = null; clearTimeout(timer);
      status(consuming ? "Pausando: termina el guardado o la actualización del paquete en curso." : "Tanda pausada. Comprobá el estado para continuar."); sync();
    });
    folderButton?.addEventListener("click", async () => {
      if (pending || operation || dead) return;
      const rev = revision; operation = true; sync();
      try { await saver.choose(); if (current(rev)) status("Carpeta autorizada. Pulsá Continuar para comprobar el estado."); }
      catch (error) { if (current(rev)) showError(error); }
      finally { if (current(rev)) { operation = false; sync(); } }
    });
    finalizeButton?.addEventListener("click", () => { paused = true; retryPlan = null; clearTimeout(timer); void finalizeArchive(true); });
    return { preview, get active() { return !panel.hidden; }, get pending() { return pending || operation; }, get batchActive() { return Boolean(batch); },
      leave() { dead = true; revision++; clearTimeout(timer); retryPlan = null; saver?.leave(); pending = false; operation = false; driving = false; consuming = false; closing = false; archiveTicketPending = false; },
      restore() { dead = false; paused = true; if (!panel.hidden) { status("La conexión se interrumpió. Comprobá el estado para continuar."); sync(); } } };
  };
})();
