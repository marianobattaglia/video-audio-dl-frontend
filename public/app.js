"use strict";

const form = document.querySelector("#download-form");
const urlInput = document.querySelector("#media-url");
const credentialInput = document.querySelector("#access-credential");
const credentialField = document.querySelector("#credential-field");
const clearButton = document.querySelector("#clear-url");
const submitButton = document.querySelector("#submit-button");
const jobPanel = document.querySelector("#job-panel");
const jobIndicator = document.querySelector("#job-indicator");
const jobTitle = document.querySelector("#job-title");
const jobMessage = document.querySelector("#job-message");
const jobPercent = document.querySelector("#job-percent");
const progressBar = document.querySelector("#progress-bar");
const progressTrack = document.querySelector("#progress-track");
const fileLink = document.querySelector("#file-link");
const cancelButton = document.querySelector("#cancel-button");
const resetButton = document.querySelector("#reset-button");
const jobError = document.querySelector("#job-error");
const connectionDialog = document.querySelector("#connection-dialog");
const connectionTitle = document.querySelector("#connection-title");
const connectionMessage = document.querySelector("#connection-message");
const connectionClose = document.querySelector("#connection-close");
const CONNECTION_FAILURE = "No pudimos conectar con el servicio. Intentá nuevamente en unos minutos.";
const SESSION_KEY = "videoAudioDl.accessCredential";
const requests = new Set();
let authRequired = null;
let apiOrigin;
try {
  const configured = new URL(window.APP_CONFIG?.apiBaseUrl);
  if (!["http:", "https:"].includes(configured.protocol) || configured.origin !== window.APP_CONFIG.apiBaseUrl) throw new Error();
  apiOrigin = configured.origin;
} catch {
  submitButton.disabled = true;
  connectionTitle.textContent = "Servicio no configurado";
  connectionMessage.textContent = "No pudimos preparar el servicio. Intentá nuevamente más tarde.";
  connectionDialog.showModal();
}

// Discard credentials retained by an older client; keep new entries in this page only.
try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be disabled */ }
credentialInput.value = "";

let activeJobId = null;
let pollTimer = null;
let polling = false;
let jobRevision = 0;
let busy = false;
let submitting = false;
let wakeAttempt = null;
let connectionRevision = 0;
let leaving = false;
let fileRequestPending = false;

function apiUrl(pathname) { return new URL(pathname, `${apiOrigin}/`).href; }

function setAccessMode(required) {
  authRequired = required;
  credentialField.hidden = !required;
  credentialInput.required = required;
  credentialInput.disabled = busy || !required;
  if (!required) {
    credentialInput.value = "";
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be disabled */ }
  }
}

async function request(pathname, { method = "GET", body, timeout = 15000, health = false } = {}) {
  const controller = new AbortController();
  requests.add(controller);
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = {};
  if (!health && authRequired === true) headers.Authorization = `BearerEncoded ${encodeURIComponent(credentialInput.value)}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(apiUrl(pathname), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer"
    });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error(CONNECTION_FAILURE);
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "No se pudo completar la solicitud.");
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw new Error(CONNECTION_FAILURE);
  } finally {
    clearTimeout(timer);
    requests.delete(controller);
  }
}

function updateSubmit() {
  submitButton.disabled = !apiOrigin || busy || submitting || Boolean(wakeAttempt) || leaving;
  submitButton.querySelector(".button-label").textContent = wakeAttempt ? "Conectando…" : busy || submitting ? "Procesando…" : "Preparar descarga";
}

function setBusy(value) {
  busy = value;
  updateSubmit();
  form.querySelectorAll("input").forEach((input) => { input.disabled = value; });
  credentialInput.disabled = value || authRequired !== true;
  clearButton.disabled = value;
  cancelButton.hidden = !value;
  resetButton.hidden = value;
}

function showConnection(title, message, button = "Cerrar") {
  if (leaving) return;
  connectionTitle.textContent = title;
  connectionMessage.textContent = message;
  connectionClose.textContent = button;
  if (!connectionDialog.open) connectionDialog.showModal();
}

function checkReadiness() {
  if (wakeAttempt) return wakeAttempt;
  const revision = connectionRevision;
  let showedWaiting = false;
  const waitingTimer = setTimeout(() => {
    if (revision !== connectionRevision || leaving) return;
    showedWaiting = true;
    showConnection("Preparando el servicio", "El servicio se está preparando. Volvé a intentarlo en unos minutos.");
  }, 1000);
  wakeAttempt = (async () => {
    try {
      const health = await request("/healthz", { health: true, timeout: 120000 });
      if (revision !== connectionRevision || leaving) return false;
      if (health.status !== "ok") throw new Error(CONNECTION_FAILURE);
      // Older API versions require a credential and do not expose this flag.
      setAccessMode(typeof health.authRequired === "boolean" ? health.authRequired : true);
      if (showedWaiting) {
        showConnection("El servicio está listo", "Ya podés volver a intentar la descarga.", "Volver al formulario");
        return false;
      }
      return true;
    } catch {
      if (revision === connectionRevision) showConnection("No pudimos conectar", CONNECTION_FAILURE);
      return false;
    } finally {
      clearTimeout(waitingTimer);
      wakeAttempt = null;
      updateSubmit();
    }
  })();
  updateSubmit();
  return wakeAttempt;
}

connectionClose.addEventListener("click", () => { connectionDialog.close(); submitButton.focus(); });

function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

function showJob() {
  jobPanel.hidden = false;
  jobError.hidden = true;
  jobError.textContent = "";
  fileLink.hidden = true;
  fileLink.removeAttribute("href");
  progressTrack.hidden = false;
  progressBar.style.width = "0%";
  jobPercent.textContent = "";
}

function showJobError(error, title = "No se pudo completar") {
  stopPolling();
  setBusy(false);
  jobPanel.hidden = false;
  jobIndicator.className = "job-indicator is-error";
  jobTitle.textContent = title;
  jobMessage.textContent = error.message;
  jobError.textContent = error.message;
  jobError.hidden = false;
  progressTrack.hidden = true;
  jobPercent.textContent = "";
  fileLink.hidden = true;
  fileLink.removeAttribute("href");
  cancelButton.hidden = true;
  resetButton.hidden = false;
}

function renderJob(job) {
  jobMessage.textContent = job.message || "Procesando…";
  if (job.progress !== null && job.progress !== undefined) {
    const amount = Math.max(0, Math.min(100, Number(job.progress)));
    progressBar.style.width = `${amount}%`;
    jobPercent.textContent = `${Math.floor(amount)}%`;
  }
  if (job.status === "complete" && job.canDownload) {
    stopPolling();
    setBusy(false);
    jobIndicator.className = "job-indicator is-success";
    jobTitle.textContent = "Tu archivo está listo";
    jobMessage.textContent = job.filename || "Descarga preparada para tu dispositivo.";
    progressBar.style.width = "100%";
    jobPercent.textContent = "100%";
    fileLink.href = "#";
    fileLink.hidden = false;
    return;
  }
  if (["failed", "cancelled", "delivered"].includes(job.status)) {
    stopPolling();
    setBusy(false);
    fileLink.hidden = true;
    progressTrack.hidden = true;
    jobIndicator.className = job.status === "failed" ? "job-indicator is-error" : "job-indicator is-success";
    jobTitle.textContent = job.status === "failed" ? "No se pudo completar" : "Listo";
    if (job.status === "failed") showJobError(new Error(job.message));
  }
}

async function pollJob() {
  if (!activeJobId || leaving) return;
  if (polling) { pollTimer = setTimeout(pollJob, 1000); return; }
  const id = activeJobId;
  const revision = jobRevision;
  polling = true;
  try {
    const job = await request(`/api/jobs/${id}`);
    if (id !== activeJobId || revision !== jobRevision || leaving) return;
    renderJob(job);
    if (["queued", "running"].includes(job.status)) pollTimer = setTimeout(pollJob, 1000);
  } catch (error) {
    if (id !== activeJobId || revision !== jobRevision || leaving) return;
    const lost = [404, 410].includes(error.status);
    if (lost) activeJobId = null;
    showJobError(error, lost ? "La descarga se interrumpió" : "Se perdió la conexión");
    if (!error.status) void checkReadiness();
  } finally { polling = false; }
}

urlInput.addEventListener("input", () => { clearButton.hidden = urlInput.value.length === 0; });
clearButton.addEventListener("click", () => { urlInput.value = ""; clearButton.hidden = true; urlInput.focus(); });
form.querySelectorAll('input[name="kind"]').forEach((input) => {
  input.addEventListener("change", () => {
    form.querySelectorAll(".format-option").forEach((option) => option.classList.remove("selected"));
    input.closest(".format-option").classList.add("selected");
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || submitting || wakeAttempt || !apiOrigin || leaving) return;
  submitting = true;
  updateSubmit();
  try {
    if (!await checkReadiness() || leaving) return;
    if (authRequired && !credentialInput.value) {
      showJobError(new Error("Ingresá la clave de acceso para continuar."), "Se requiere una clave de acceso");
      credentialInput.focus();
      return;
    }
    stopPolling();
    jobRevision += 1;
    activeJobId = null;
    const kind = form.querySelector('input[name="kind"]:checked').value;
    const url = urlInput.value.trim();
    showJob();
    setBusy(true);
    jobIndicator.className = "job-indicator is-running";
    jobTitle.textContent = kind === "audio" ? "Preparando tu audio" : "Preparando tu video";
    jobMessage.textContent = "Validando el enlace…";
    const job = await request("/api/jobs", { method: "POST", body: { url, kind }, timeout: 30000 });
    if (leaving) return;
    activeJobId = job.id;
    renderJob(job);
    if (["queued", "running"].includes(job.status)) pollTimer = setTimeout(pollJob, 1000);
  } catch (error) {
    if (leaving) return;
    if (!error.status) {
      showJobError(new Error("Se perdió la conexión. La solicitud pudo haberse recibido. Esperá unos minutos antes de intentar otra vez."), "No pudimos confirmar la descarga");
      // Health never replays a POST whose outcome is unknown.
      void checkReadiness();
    } else showJobError(error, error.status === 401 ? "Revisá la clave de acceso" : "No se pudo iniciar");
  } finally { submitting = false; updateSubmit(); }
});

cancelButton.addEventListener("click", async () => {
  if (!activeJobId || cancelButton.disabled) return;
  const id = activeJobId;
  cancelButton.disabled = true;
  jobRevision += 1;
  stopPolling();
  try {
    const job = await request(`/api/jobs/${id}`, { method: "DELETE" });
    if (activeJobId === id && !leaving) renderJob(job);
  } catch (error) {
    if (!leaving) showJobError(error, "No pudimos confirmar la cancelación");
  } finally { cancelButton.disabled = false; }
});

resetButton.addEventListener("click", () => {
  stopPolling();
  jobRevision += 1;
  connectionRevision += 1;
  if (connectionDialog.open) connectionDialog.close();
  for (const controller of requests) controller.abort();
  activeJobId = null;
  jobPanel.hidden = true;
  jobError.hidden = true;
  fileLink.hidden = true;
  setBusy(false);
  urlInput.focus();
});

fileLink.addEventListener("click", async (event) => {
  event.preventDefault();
  if (!activeJobId || fileRequestPending || leaving) return;
  const id = activeJobId;
  fileRequestPending = true;
  try {
    const ticket = await request(`/api/jobs/${id}/ticket`, { method: "POST" });
    if (activeJobId !== id || leaving) return;
    const target = new URL(ticket.downloadUrl, `${apiOrigin}/`);
    if (target.origin !== apiOrigin || target.pathname !== `/api/jobs/${id}/file`) throw new Error(CONNECTION_FAILURE);
    const anchor = document.createElement("a");
    anchor.href = target.href;
    anchor.download = ticket.filename || "descarga";
    anchor.referrerPolicy = "no-referrer";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    fileLink.hidden = true;
    jobMessage.textContent = "La descarga comenzará en tu navegador.";
    pollTimer = setTimeout(pollJob, 1000);
  } catch (error) {
    if (!leaving && activeJobId === id) showJobError(error, [404, 410].includes(error.status) ? "El archivo ya no está disponible" : "No se pudo descargar");
  } finally { fileRequestPending = false; }
});

window.addEventListener("pagehide", () => {
  credentialInput.value = "";
  leaving = true;
  connectionRevision += 1;
  stopPolling();
  for (const controller of requests) controller.abort();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  leaving = false;
  updateSubmit();
  if (activeJobId && busy) void pollJob();
  else if (busy) showJobError(new Error("La conexión se interrumpió. Esperá unos minutos antes de intentar nuevamente."), "No pudimos confirmar la descarga");
});
