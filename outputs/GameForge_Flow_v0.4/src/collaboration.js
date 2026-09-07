// Same-origin protocol: guests open the host URL; no cross-origin storage or CORS bypass.
let checkedController = null;
async function verifyWorker() {
  const controller = globalThis.navigator?.serviceWorker?.controller;
  if (!controller || controller === checkedController) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = error => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error("Atualize a página para ativar a conexão segura da equipe.")), 1500);
    channel.port1.onmessage = event => event.data?.version === "0.9.0" ? finish() : finish(new Error("Atualize a página para conectar a equipe."));
    controller.postMessage({ type: "TEAM_API_READY" }, [channel.port2]);
  });
  checkedController = controller;
}
export async function api(path, { method = "GET", token, hostKey, body, timeout = 10000 } = {}) {
  await verifyWorker();
  const response = await fetch(path, {
    method, cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(timeout),
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(hostKey ? { "X-Host-Key": hostKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("O servidor de equipe não está ativo. Inicie pelo START.bat atualizado."); }
  if (!response.ok) { const error = Object.assign(new Error(data.error || "Falha de conexão."), data); error.status = response.status; throw error; }
  return data;
}

export function readConnectionLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("host")) sessionStorage.setItem("gf-host-key", params.get("host"));
  if (params.get("room") && params.get("token")) sessionStorage.setItem("gf-session", JSON.stringify({ roomId: params.get("room"), token: params.get("token") }));
  if (params.has("host") || params.has("token")) history.replaceState(null, "", location.pathname + location.search);
  try { return JSON.parse(sessionStorage.getItem("gf-session") || "null"); } catch { return null; }
}

export function connectionLink(base, roomId, token) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use um endereço HTTP da rede ou HTTPS do túnel.");
  url.pathname = "/"; url.search = "";
  url.hash = new URLSearchParams({ room: roomId, token }).toString();
  return url.href;
}

export class Collaboration {
  constructor({ onStatus, onRemote, onPresence, canApply, getPresence }) {
    let clientId = sessionStorage.getItem("gf-client-id");
    if (!clientId) { clientId = globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}`; sessionStorage.setItem("gf-client-id", clientId); }
    Object.assign(this, { onStatus, onRemote, onPresence, canApply, getPresence, clientId, presence: [], eventId: 0, session: null, draft: null, busy: false, status: "local", generation: 0 });
  }
  setStatus(status, message = "") { this.status = status; this.message = message; this.onStatus?.(status, message); }
  get active() { return !!this.session; }
  get admin() { return !this.active || this.principal?.admin; }
  can(permission) { return !this.active || this.admin || this.principal?.permissions?.includes(permission); }
  get dirty() { return this.draft !== null; }
  get draftKey() { return `gf-team-draft:${this.serverId}:${this.session.roomId}`; }
  path(suffix = "") { return `/api/rooms/${encodeURIComponent(this.session.roomId)}${suffix}`; }
  async connect(session, initial) {
    const snapshot = initial || await api(`/api/rooms/${encodeURIComponent(session.roomId)}`, { token: session.token });
    this.stop();
    this.session = session; this.serverId = snapshot.serverId; this.revision = snapshot.revision;
    this.principal = snapshot.principal; this.base = snapshot.project; this.draft = null;
    sessionStorage.setItem("gf-session", JSON.stringify(session));
    const saved = localStorage.getItem(this.draftKey);
    if (saved) {
      try {
        const recovery = JSON.parse(saved);
        if (recovery.project && JSON.stringify(recovery.project) !== JSON.stringify(this.base)) this.draft = recovery.project;
      } catch { /* Keep corrupt recovery bytes untouched for manual retrieval. */ }
    }
    this.setStatus(this.dirty ? "conflict" : "synced", this.dirty ? "Rascunho pendente recuperado. Baixe uma cópia antes de usar a versão do host." : "");
    this.updatePresence();
    this.presenceTimer = setInterval(() => this.updatePresence(), 12000);
    this.listen(this.generation);
    return this.draft || this.base;
  }
  checkpoint() {
    if (!this.active) return;
    if (this.dirty) localStorage.setItem(this.draftKey, JSON.stringify({ revision: this.revision, project: this.draft }));
    else localStorage.removeItem(this.draftKey);
  }
  queue(project) {
    if (!this.active) return;
    this.draft = JSON.stringify(project) === JSON.stringify(this.base) ? null : JSON.parse(JSON.stringify(project));
    try { this.checkpoint(); } catch { this.setStatus("conflict", "Armazenamento local cheio. Exporte seu rascunho antes de fechar."); return; }
    if (["conflict", "denied"].includes(this.status)) return;
    this.setStatus(this.dirty ? "pending" : "synced");
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.flush(), 500);
  }
  fail(error) {
    this.setStatus(error.status === 409 ? "conflict" : [400, 403, 404, 413].includes(error.status) ? "denied" : "offline", error.message || "Host indisponível. Rascunho salvo neste dispositivo.");
  }
  async flush() {
    if (!this.active || !this.dirty || this.busy || ["conflict", "denied"].includes(this.status)) return;
    const generation = this.generation, sent = this.draft;
    this.busy = true;
    try {
      const snapshot = await api(this.path(), { method: "PUT", token: this.session.token, body: { revision: this.revision, project: sent } });
      if (generation !== this.generation) return;
      this.base = snapshot.project; this.revision = snapshot.revision;
      if (JSON.stringify(this.draft) === JSON.stringify(sent)) this.draft = null;
      this.checkpoint(); this.setStatus(this.dirty ? "pending" : "synced");
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async tick() {
    if (!this.active || this.busy || ["conflict", "denied"].includes(this.status)) return;
    if (this.dirty) return this.flush();
    const generation = this.generation;
    this.busy = true;
    try {
      const snapshot = await api(this.path(), { token: this.session.token });
      if (generation !== this.generation) return;
      this.principal = snapshot.principal;
      if (snapshot.revision !== this.revision) {
        if (this.dirty || !this.canApply()) return;
        this.base = snapshot.project; this.revision = snapshot.revision;
        this.onRemote(snapshot.project);
      }
      this.setStatus(this.dirty ? "pending" : "synced");
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  applySnapshot(snapshot) {
    this.principal = snapshot.principal || this.principal;
    if (snapshot.revision !== this.revision) {
      if (this.dirty || !this.canApply()) return false;
      this.base = snapshot.project; this.revision = snapshot.revision; this.onRemote(snapshot.project);
    }
    return true;
  }
  async listen(generation) {
    while (this.active && generation === this.generation) {
      try {
        const started = Date.now();
        const snapshot = await api(`${this.path("/events")}?since=${encodeURIComponent(this.revision)}&event=${encodeURIComponent(this.eventId)}`, { token: this.session.token, timeout: 30000 });
        if (!this.active || generation !== this.generation) return;
        this.eventId = snapshot.eventId || 0; this.presence = snapshot.presence || []; this.onPresence?.(this.presence);
        const applied = this.applySnapshot(snapshot);
        if (!applied && this.dirty && snapshot.revision !== this.revision) {
          this.setStatus("conflict", "O Save mudou no host enquanto você editava. Seu rascunho foi preservado.");
        } else if (!["conflict", "denied"].includes(this.status)) {
          this.setStatus(this.dirty ? "pending" : "synced");
        }
        if (Date.now() - started < 200) await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        if (!this.active || generation !== this.generation) return;
        this.fail(error); await new Promise(resolve => setTimeout(resolve, 1400));
      }
    }
  }
  async updatePresence() {
    if (!this.active) return;
    const context = this.getPresence?.() || {};
    try {
      const result = await api(this.path("/presence"), { method: "POST", token: this.session.token, body: { clientId: this.clientId, stage: context.stage || "hub", editing: context.editing || "" } });
      this.eventId = Math.max(this.eventId, result.eventId || 0);
    } catch { /* The event loop owns the visible offline state. */ }
  }
  async sideEffect(path, body) {
    await this.flush();
    if (this.dirty || this.busy) throw new Error("Aguarde a sincronização terminar antes de continuar.");
    const result = await api(this.path(path), { method: "POST", token: this.session.token, body: { revision: this.revision, ...body }, timeout: 25000 });
    this.base = result.snapshot.project; this.revision = result.snapshot.revision; this.principal = result.snapshot.principal; this.draft = null;
    this.checkpoint(); this.setStatus("synced");
    return result;
  }
  addComment(targetType, targetId, text) { return this.sideEffect("/comments", { targetType, targetId, text }); }
  async uploadFile(targetType, targetId, file) {
    if (file.size > 6_000_000) throw new Error("O arquivo deve ter no máximo 6 MB.");
    const content = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(file);
    });
    return this.sideEffect("/files", { targetType, targetId, name: file.name, mime: file.type || "application/octet-stream", content });
  }
  async downloadFile(fileId, name = "arquivo") {
    const response = await fetch(this.path(`/files/${encodeURIComponent(fileId)}`), { cache: "no-store", credentials: "omit", headers: { Authorization: `Bearer ${this.session.token}` } });
    if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async acceptHost() {
    if (this.busy) throw new Error("Aguarde a sincronização atual terminar.");
    if (this.draft) localStorage.setItem(`${this.draftKey}:recovery:${Date.now()}`, JSON.stringify(this.draft));
    const snapshot = await api(this.path(), { token: this.session.token });
    this.base = snapshot.project; this.revision = snapshot.revision; this.draft = null;
    this.checkpoint(); this.onRemote(snapshot.project); this.setStatus("synced");
  }
  stop() {
    this.generation++; clearInterval(this.timer); clearInterval(this.presenceTimer); clearTimeout(this.debounce);
    this.busy = false; this.session = null; this.draft = null; this.presence = []; this.onPresence?.([]);
  }
}
