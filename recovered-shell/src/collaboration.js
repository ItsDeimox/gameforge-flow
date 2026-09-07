// Same-origin protocol: guests open the host URL; no cross-origin storage or CORS bypass.
let checkedController = null;
async function verifyWorker() {
  const controller = globalThis.navigator?.serviceWorker?.controller;
  if (!controller || controller === checkedController) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = error => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error("Atualize a página para ativar a conexão segura da equipe.")), 1500);
    channel.port1.onmessage = event => event.data?.version === "0.7.0" ? finish() : finish(new Error("Atualize a página para conectar a equipe."));
    controller.postMessage({ type: "TEAM_API_READY" }, [channel.port2]);
  });
  checkedController = controller;
}
export async function api(path, { method = "GET", token, hostKey, body } = {}) {
  await verifyWorker();
  const response = await fetch(path, {
    method, cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10000),
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(hostKey ? { "X-Host-Key": hostKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("O servidor de equipe não está ativo. Inicie pelo START.bat atualizado."); }
  if (!response.ok) { const error = new Error(data.error || "Falha de conexão."); error.status = response.status; throw error; }
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
  constructor({ onStatus, onRemote, canApply }) {
    Object.assign(this, { onStatus, onRemote, canApply, session: null, draft: null, busy: false, status: "local", generation: 0 });
  }
  setStatus(status, message = "") { this.status = status; this.message = message; this.onStatus?.(status, message); }
  get active() { return !!this.session; }
  get admin() { return !this.active || this.principal?.admin; }
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
    this.timer = setInterval(() => this.tick(), 2000);
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
  async acceptHost() {
    if (this.busy) throw new Error("Aguarde a sincronização atual terminar.");
    if (this.draft) localStorage.setItem(`${this.draftKey}:recovery:${Date.now()}`, JSON.stringify(this.draft));
    const snapshot = await api(this.path(), { token: this.session.token });
    this.base = snapshot.project; this.revision = snapshot.revision; this.draft = null;
    this.checkpoint(); this.onRemote(snapshot.project); this.setStatus("synced");
  }
  stop() {
    this.generation++; clearInterval(this.timer); clearTimeout(this.debounce);
    this.busy = false; this.session = null; this.draft = null;
  }
}
