from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs, quote
import argparse, base64, binascii, hashlib, hmac, json, mimetypes, re, secrets, shutil, socket, sqlite3, threading, time, webbrowser
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent
PUBLIC = {
    "/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css", "/app.js": "app.js",
    "/manifest.webmanifest": "manifest.webmanifest", "/service-worker.js": "service-worker.js",
    "/src/domain.js": "src/domain.js", "/src/storage.js": "src/storage.js",
    "/src/markdown.js": "src/markdown.js", "/src/collaboration.js": "src/collaboration.js",
}
SPECIALTIES = {"design", "code", "level", "art2d", "art", "animation", "vfx", "techart", "ui", "audio", "music", "lore", "qa", "production"}
PERMISSIONS = {"vision", "production", "execution", "comments", "files", "team", "settings"}
DEFAULT_PERMISSIONS = {"vision", "production", "execution", "comments", "files"}
DOC_STATUSES = {"draft", "experiment", "probable", "canon", "deprecated"}
PRIORITIES = {"low", "normal", "high", "critical"}
PROD_STATUSES = {"inbox", "breakdown", "ready", "execution"}
EXEC_STATUSES = {"todo", "doing", "blocked", "review", "done"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,160}$")
TARGETS = {"doc": ("docs", "vision"), "production": ("production", "production"), "execution": ("execution", "execution")}


class ApiError(Exception):
    def __init__(self, status, message, data=None):
        super().__init__(message); self.status = status; self.data = data or {}


def digest(value): return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clean_text(value, name, maximum=200, allow_empty=True):
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()): raise ApiError(400, f"{name} inválido.")
    return value


def validate_id(value, name="Identificador"):
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value): raise ApiError(400, f"{name} inválido.")


def validate_notes(item):
    for key, label in (("comments", "Comentários"), ("attachments", "Anexos")):
        rows = item.get(key, [])
        if not isinstance(rows, list): raise ApiError(400, f"{label} inválido.")
        for row in rows:
            if not isinstance(row, dict): raise ApiError(400, f"{label} inválido.")
            if row.get("id") is not None: validate_id(row["id"], "ID")


def validate_project(project):
    if not isinstance(project, dict): raise ApiError(400, "Save inválido.")
    if len(json.dumps(project, ensure_ascii=False).encode("utf-8")) > 8_000_000: raise ApiError(413, "Save grande demais.")
    if not isinstance(project.get("schemaVersion"), int) or not 1 <= project["schemaVersion"] <= 5: raise ApiError(400, "Versão do Save inválida.")
    validate_id(project.get("id"), "ID do Save"); clean_text(project.get("name"), "Nome", 80, False)
    if not isinstance(project.get("settings", {}), dict): raise ApiError(400, "Configurações inválidas.")
    for key in ("docs", "production", "execution", "history", "members"):
        if not isinstance(project.get(key), list): raise ApiError(400, f"Campo {key} inválido.")
    seen_members = set()
    for member in project["members"]:
        if not isinstance(member, dict): raise ApiError(400, "Membro inválido.")
        validate_id(member.get("id"), "ID do membro"); clean_text(member.get("name"), "Nome do membro", 80, False); clean_text(member.get("role", ""), "Cargo", 100)
        if member["id"] in seen_members: raise ApiError(400, "ID de membro repetido.")
        seen_members.add(member["id"])
        specs = member.get("specialties", []); permissions = member.get("permissions", list(DEFAULT_PERMISSIONS))
        if not isinstance(specs, list) or any(spec not in SPECIALTIES for spec in specs): raise ApiError(400, "Especialidade inválida.")
        if not isinstance(permissions, list) or any(value not in PERMISSIONS for value in permissions): raise ApiError(400, "Permissão inválida.")
    for doc in project["docs"]:
        if not isinstance(doc, dict): raise ApiError(400, "Documento inválido.")
        validate_id(doc.get("id"), "ID do documento"); clean_text(doc.get("title", ""), "Título", 240); clean_text(doc.get("markdown", ""), "Conteúdo", 700000)
        if doc.get("status", "draft") not in DOC_STATUSES: raise ApiError(400, "Estado criativo inválido.")
        validate_notes(doc)
    members_by_id = {member["id"]: member for member in project["members"]}
    for item in project["production"]:
        if not isinstance(item, dict): raise ApiError(400, "Demanda inválida.")
        validate_id(item.get("id"), "ID da demanda")
        if item.get("category", "unclassified") not in SPECIALTIES | {"unclassified"}: raise ApiError(400, "Categoria inválida.")
        if item.get("status", "inbox") not in PROD_STATUSES: raise ApiError(400, "Etapa de produção inválida.")
        if item.get("priority", "normal") not in PRIORITIES: raise ApiError(400, "Prioridade inválida.")
        if "suggestedPriority" in item and item["suggestedPriority"] not in PRIORITIES: raise ApiError(400, "Prioridade sugerida inválida.")
        if "creativeStatus" in item and item["creativeStatus"] not in DOC_STATUSES: raise ApiError(400, "Estado criativo inválido.")
        if item.get("assigneeId") is not None and item["assigneeId"] not in seen_members: raise ApiError(400, "Responsável não pertence à equipe.")
        item["assignee"] = members_by_id[item["assigneeId"]]["name"] if item.get("assigneeId") else "Não atribuído"; validate_notes(item)
    for item in project["execution"]:
        if not isinstance(item, dict): raise ApiError(400, "Tarefa inválida.")
        validate_id(item.get("id"), "ID da tarefa")
        if item.get("category", "design") not in SPECIALTIES: raise ApiError(400, "Categoria inválida.")
        if item.get("status", "todo") not in EXEC_STATUSES: raise ApiError(400, "Estado da tarefa inválido.")
        if item.get("priority", "normal") not in PRIORITIES: raise ApiError(400, "Prioridade inválida.")
        if item.get("assigneeId") is not None and item["assigneeId"] not in seen_members: raise ApiError(400, "Responsável não pertence à equipe.")
        item["assignee"] = members_by_id[item["assigneeId"]]["name"] if item.get("assigneeId") else "Não atribuído"; validate_notes(item)
    return project


class Store:
    def __init__(self, directory):
        self.root = Path(directory); self.root.mkdir(parents=True, exist_ok=True); self.files_root = self.root / "files"; self.files_root.mkdir(exist_ok=True)
        self.db_path = self.root / "gameforge-flow.sqlite3"; self.lock = threading.RLock(); self.events_lock = threading.Condition(); self.event_ids = {}; self.presence = {}
        key_path = self.root / "host-key.txt"
        if key_path.exists(): self.host_key = key_path.read_text(encoding="utf-8").strip()
        else: self.host_key = secrets.token_urlsafe(32); key_path.write_text(self.host_key, encoding="utf-8")
        with self.connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS rooms(room_id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_hash TEXT NOT NULL,project_json TEXT NOT NULL,revision INTEGER NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS invites(room_id TEXT NOT NULL,member_id TEXT NOT NULL,token_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,PRIMARY KEY(room_id,token_hash));
              CREATE INDEX IF NOT EXISTS invites_token ON invites(room_id,token_hash,active);
              CREATE TABLE IF NOT EXISTS versions(room_id TEXT NOT NULL,revision INTEGER NOT NULL,project_json TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(room_id,revision));
            """)
            row = db.execute("SELECT value FROM meta WHERE key='server_id'").fetchone()
            if row: self.server_id = row[0]
            else: self.server_id = secrets.token_urlsafe(12); db.execute("INSERT INTO meta VALUES('server_id',?)", (self.server_id,))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=10); db.row_factory = sqlite3.Row
        try: yield db; db.commit()
        except Exception: db.rollback(); raise
        finally: db.close()

    def _room(self, db, room_id):
        row = db.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not row: raise ApiError(404, "Save compartilhado não encontrado.")
        return row

    def _principal(self, db, row, token):
        if not token: raise ApiError(403, "Convite inválido ou ausente.")
        hashed = digest(token); project = json.loads(row["project_json"])
        if hmac.compare_digest(row["owner_hash"], hashed): return {"admin": True, "memberId": None, "name": "Host", "role": "Administrador", "permissions": sorted(PERMISSIONS)}
        invite = db.execute("SELECT member_id FROM invites WHERE room_id=? AND token_hash=? AND active=1", (row["room_id"], hashed)).fetchone()
        if not invite: raise ApiError(403, "Convite inválido ou revogado.")
        member = next((member for member in project.get("members", []) if member.get("id") == invite["member_id"]), None)
        if not member: raise ApiError(403, "Este membro não faz mais parte da equipe.")
        return {"admin": False, "memberId": member["id"], "name": member.get("name", "Colaborador"), "role": member.get("role", "Colaborador"), "permissions": member.get("permissions", sorted(DEFAULT_PERMISSIONS))}

    def allowed(self, principal, permission): return principal["admin"] or permission in principal.get("permissions", [])
    def require(self, principal, permission):
        if not self.allowed(principal, permission): raise ApiError(403, f"Seu acesso não permite alterar {permission}.")
    def snapshot(self, row, principal, token=None): return {"serverId": self.server_id, "roomId": row["room_id"], "token": token, "revision": row["revision"], "project": json.loads(row["project_json"]), "principal": principal}
    def _signal(self, room_id):
        with self.events_lock: self.event_ids[room_id] = self.event_ids.get(room_id, 0) + 1; self.events_lock.notify_all()
    def _commit(self, db, row, project):
        new_revision = row["revision"] + 1; stamp = time.time(); encoded = json.dumps(project, ensure_ascii=False, separators=(",", ":"))
        db.execute("UPDATE rooms SET name=?,project_json=?,revision=?,updated=? WHERE room_id=?", (project["name"], encoded, new_revision, stamp, row["room_id"])); db.execute("INSERT INTO versions VALUES(?,?,?,?)", (row["room_id"], new_revision, encoded, stamp)); return self._room(db, row["room_id"])

    def create(self, project):
        project = validate_project(project); room_id = secrets.token_urlsafe(9); token = secrets.token_urlsafe(32); stamp = time.time(); encoded = json.dumps(project, ensure_ascii=False, separators=(",", ":"))
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO rooms VALUES(?,?,?,?,?,?,?)", (room_id, project["name"], digest(token), encoded, 1, stamp, stamp)); db.execute("INSERT INTO versions VALUES(?,?,?,?)", (room_id, 1, encoded, stamp)); row = self._room(db, room_id)
        self._signal(room_id); return self.snapshot(row, {"admin": True, "memberId": None, "name": "Host", "role": "Administrador", "permissions": sorted(PERMISSIONS)}, token)

    def read(self, room_id, token):
        with self.connect() as db: row = self._room(db, room_id); return self.snapshot(row, self._principal(db, row, token))

    def _enforce_update(self, principal, previous, project):
        if principal["admin"]: return
        for key, permission in (("docs", "vision"), ("production", "production"), ("execution", "execution"), ("members", "team"), ("settings", "settings"), ("name", "settings")):
            if project.get(key) != previous.get(key): self.require(principal, permission)
        if any(project.get(key) != previous.get(key) for key in ("id", "schemaVersion", "createdAt")): raise ApiError(403, "A estrutura do Save só pode ser alterada pelo host.")

    def update(self, room_id, token, revision, project):
        project = validate_project(project)
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self._room(db, room_id); principal = self._principal(db, row, token)
            if row["revision"] != revision: raise ApiError(409, "O Save mudou no host. Revise o conflito antes de continuar.", {"snapshot": self.snapshot(row, principal)})
            previous = json.loads(row["project_json"])
            if project["id"] != previous["id"]: raise ApiError(400, "O ID do Save não pode mudar.")
            self._enforce_update(principal, previous, project)
            old_ids = {member["id"] for member in previous["members"]}; new_ids = {member["id"] for member in project["members"]}
            for member_id in old_ids - new_ids: db.execute("UPDATE invites SET active=0 WHERE room_id=? AND member_id=?", (room_id, member_id))
            row = self._commit(db, row, project); result = self.snapshot(row, principal)
        self._signal(room_id); return result

    def invite(self, room_id, owner_token, member_id):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self._room(db, room_id); principal = self._principal(db, row, owner_token); self.require(principal, "team")
            if not any(member.get("id") == member_id for member in json.loads(row["project_json"])["members"]): raise ApiError(400, "Membro não encontrado.")
            db.execute("UPDATE invites SET active=0 WHERE room_id=? AND member_id=?", (room_id, member_id)); token = secrets.token_urlsafe(32); db.execute("INSERT INTO invites VALUES(?,?,?,?,?)", (room_id, member_id, digest(token), 1, time.time()))
        return {"roomId": room_id, "memberId": member_id, "token": token}

    def _target(self, project, target_type, target_id):
        if target_type not in TARGETS: raise ApiError(400, "Tipo de conteúdo inválido.")
        collection, permission = TARGETS[target_type]; target = next((row for row in project[collection] if row.get("id") == target_id), None)
        if not target: raise ApiError(404, "Conteúdo não encontrado.")
        return target, permission

    def add_comment(self, room_id, token, revision, target_type, target_id, text):
        text = clean_text(text, "Comentário", 4000, False).strip()
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self._room(db, room_id); principal = self._principal(db, row, token)
            if row["revision"] != revision: raise ApiError(409, "O Save mudou antes do comentário ser enviado.", {"snapshot": self.snapshot(row, principal)})
            project = json.loads(row["project_json"]); target, permission = self._target(project, target_type, target_id); self.require(principal, permission); self.require(principal, "comments")
            created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()); comment = {"id": secrets.token_urlsafe(10), "text": text, "authorId": principal["memberId"], "author": principal["name"], "createdAt": created}
            target.setdefault("comments", []).append(comment); project.setdefault("history", []).insert(0, {"id": secrets.token_urlsafe(10), "type": "COMMENT_ADDED", "message": f"Comentário em “{target.get('title') or target.get('text') or 'item'}”", "actor": principal["name"], "at": created, "meta": {"targetType": target_type, "targetId": target_id}})
            row = self._commit(db, row, validate_project(project)); result = {"comment": comment, "snapshot": self.snapshot(row, principal)}
        self._signal(room_id); return result

    def add_file(self, room_id, token, revision, target_type, target_id, name, mime, content):
        name = Path(clean_text(name, "Nome do arquivo", 180, False)).name; mime = clean_text(mime or "application/octet-stream", "Tipo do arquivo", 120)
        try: payload = base64.b64decode(content, validate=True)
        except (ValueError, binascii.Error): raise ApiError(400, "Arquivo inválido.")
        if not payload or len(payload) > 6_000_000: raise ApiError(413, "O arquivo deve ter no máximo 6 MB.")
        file_id = secrets.token_urlsafe(12); folder = self.files_root / room_id; folder.mkdir(exist_ok=True); path = folder / file_id
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self._room(db, room_id); principal = self._principal(db, row, token)
            if row["revision"] != revision: raise ApiError(409, "O Save mudou antes do anexo ser enviado.", {"snapshot": self.snapshot(row, principal)})
            project = json.loads(row["project_json"]); target, permission = self._target(project, target_type, target_id); self.require(principal, permission); self.require(principal, "files")
            created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()); attachment = {"id": file_id, "name": name, "mime": mime, "size": len(payload), "authorId": principal["memberId"], "author": principal["name"], "createdAt": created, "remote": True}
            try: path.write_bytes(payload); target.setdefault("attachments", []).append(attachment); row = self._commit(db, row, validate_project(project)); result = {"attachment": attachment, "snapshot": self.snapshot(row, principal)}
            except Exception: path.unlink(missing_ok=True); raise
        self._signal(room_id); return result

    def read_file(self, room_id, token, file_id):
        validate_id(file_id, "Arquivo")
        with self.connect() as db: row = self._room(db, room_id); self._principal(db, row, token); project = json.loads(row["project_json"])
        attachment = next((a for key, _ in TARGETS.values() for item in project.get(key, []) for a in item.get("attachments", []) if a.get("id") == file_id), None); path = self.files_root / room_id / file_id
        if not attachment or not path.is_file(): raise ApiError(404, "Arquivo não encontrado.")
        return path, attachment

    def set_presence(self, room_id, token, payload):
        with self.connect() as db: row = self._room(db, room_id); principal = self._principal(db, row, token)
        client_id = payload.get("clientId", "browser"); validate_id(client_id, "Cliente"); stage = payload.get("stage") if payload.get("stage") in {"saves", "hub", "vision", "production", "execution", "settings"} else "hub"; editing = clean_text(payload.get("editing", ""), "Atividade", 160)
        key = f"{principal['memberId'] or 'host'}:{client_id}"
        with self.events_lock:
            self.presence.setdefault(room_id, {})[key] = {"clientId": client_id, "memberId": principal["memberId"], "name": principal["name"], "role": principal["role"], "stage": stage, "editing": editing, "updatedAt": time.time()}; self.event_ids[room_id] = self.event_ids.get(room_id, 0) + 1; event_id = self.event_ids[room_id]; self.events_lock.notify_all()
        return {"ok": True, "eventId": event_id}

    def _presence_rows(self, room_id):
        cutoff = time.time() - 40; rows = self.presence.setdefault(room_id, {})
        for key in [key for key, value in rows.items() if value["updatedAt"] < cutoff]: rows.pop(key, None)
        return [{**value, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(value["updatedAt"]))} for value in rows.values()]

    def events(self, room_id, token, since_revision, since_event, wait=20):
        deadline = time.monotonic() + min(max(wait, 0), 25)
        while True:
            snapshot = self.read(room_id, token)
            with self.events_lock:
                event_id = self.event_ids.get(room_id, 0); presence = self._presence_rows(room_id)
                if snapshot["revision"] != since_revision or event_id != since_event or time.monotonic() >= deadline: return {**snapshot, "eventId": event_id, "presence": presence}
                self.events_lock.wait(timeout=max(0, deadline - time.monotonic()))

    def host_info(self):
        with self.connect() as db: rooms = [{"roomId": row["room_id"], "name": row["name"], "revision": row["revision"]} for row in db.execute("SELECT room_id,name,revision FROM rooms ORDER BY updated DESC")]
        addresses = []
        try:
            for address in socket.gethostbyname_ex(socket.gethostname())[2]:
                if not address.startswith("127."): addresses.append(address)
        except OSError: pass
        addresses = sorted(set(addresses)); networks = [{"address": address, "kind": "Radmin/VPN" if address.startswith("26.") else "Rede local"} for address in addresses]; tunnels = [{"name": name, "available": bool(shutil.which(command))} for name, command in (("Cloudflare Tunnel", "cloudflared"), ("ngrok", "ngrok"))]
        return {"serverId": self.server_id, "addresses": addresses, "networks": networks, "tunnels": tunnels, "rooms": rooms}

    def resume(self, room_id):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self._room(db, room_id); token = secrets.token_urlsafe(32); db.execute("UPDATE rooms SET owner_hash=? WHERE room_id=?", (digest(token), room_id)); row = self._room(db, room_id); result = self.snapshot(row, {"admin": True, "memberId": None, "name": "Host", "role": "Administrador", "permissions": sorted(PERMISSIONS)}, token)
        self._signal(room_id); return result


class Handler(SimpleHTTPRequestHandler):
    server_version = "GameForgeFlow/0.9.0"
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, fmt, *args): print("[%s] %s" % (self.log_date_time_string(), fmt % args))
    def end_headers(self):
        if getattr(self, "_cache", None):
            self.send_header("Cache-Control", self._cache)
            if self._cache.startswith("no-store"): self.send_header("Pragma", "no-cache"); self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer"); super().end_headers()
    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin: return True
        try: return urlsplit(origin).netloc.lower() == self.headers.get("Host", "").lower()
        except ValueError: return False
    def token(self):
        value = self.headers.get("Authorization", ""); return value[7:] if value.startswith("Bearer ") else ""
    def host_ok(self): return hmac.compare_digest(self.headers.get("X-Host-Key", ""), self.server.store.host_key)
    def body(self):
        try: length = int(self.headers.get("Content-Length", "0"))
        except ValueError: raise ApiError(400, "Tamanho inválido.")
        if length <= 0: return {}
        if length > 9_000_000: raise ApiError(413, "Requisição grande demais.")
        try: return json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError): raise ApiError(400, "JSON inválido.")
    def json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8"); self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def binary(self, path, attachment):
        body = path.read_bytes(); self.send_response(200); self.send_header("Content-Type", attachment.get("mime") or mimetypes.guess_type(attachment.get("name", ""))[0] or "application/octet-stream"); self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(attachment.get('name', 'arquivo'))}"); self.send_header("Cache-Control", "private, no-store"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def api(self, method):
        if not self.origin_ok(): raise ApiError(403, "Origem não permitida.")
        split = urlsplit(self.path); path = split.path; query = parse_qs(split.query); parts = [unquote(part) for part in path.split("/") if part]
        if path == "/api/info" and method == "GET": return self.json(200, {"name": "GameForge Flow", "version": "0.9.0", "serverId": self.server.store.server_id})
        if path == "/api/host" and method == "GET":
            if not self.host_ok(): raise ApiError(403, "Chave do host inválida.")
            return self.json(200, self.server.store.host_info())
        if path == "/api/rooms" and method == "POST":
            if not self.host_ok(): raise ApiError(403, "Chave do host inválida.")
            return self.json(201, self.server.store.create(self.body().get("project")))
        if len(parts) >= 3 and parts[:2] == ["api", "rooms"]:
            room_id = parts[2]; validate_id(room_id, "Sala")
            if len(parts) == 3 and method == "GET": return self.json(200, self.server.store.read(room_id, self.token()))
            if len(parts) == 3 and method == "PUT":
                body = self.body(); return self.json(200, self.server.store.update(room_id, self.token(), body.get("revision"), body.get("project")))
            if len(parts) == 4 and parts[3] == "events" and method == "GET":
                try: since_revision = int(query.get("since", ["0"])[0]); since_event = int(query.get("event", ["0"])[0])
                except ValueError: raise ApiError(400, "Cursor de eventos inválido.")
                return self.json(200, self.server.store.events(room_id, self.token(), since_revision, since_event))
            if len(parts) == 4 and parts[3] == "presence" and method == "POST": return self.json(200, self.server.store.set_presence(room_id, self.token(), self.body()))
            if len(parts) == 4 and parts[3] == "comments" and method == "POST":
                body = self.body(); return self.json(201, self.server.store.add_comment(room_id, self.token(), body.get("revision"), body.get("targetType"), body.get("targetId"), body.get("text")))
            if len(parts) == 4 and parts[3] == "files" and method == "POST":
                body = self.body(); return self.json(201, self.server.store.add_file(room_id, self.token(), body.get("revision"), body.get("targetType"), body.get("targetId"), body.get("name"), body.get("mime"), body.get("content", "")))
            if len(parts) == 5 and parts[3] == "files" and method == "GET":
                file_path, attachment = self.server.store.read_file(room_id, self.token(), parts[4]); return self.binary(file_path, attachment)
            if len(parts) == 4 and parts[3] == "invites" and method == "POST": return self.json(201, self.server.store.invite(room_id, self.token(), self.body().get("memberId")))
            if len(parts) == 4 and parts[3] == "admin" and method == "POST":
                if not self.host_ok(): raise ApiError(403, "Chave do host inválida.")
                return self.json(200, self.server.store.resume(room_id))
        raise ApiError(404, "Rota não encontrada.")
    def static(self):
        raw = urlsplit(self.path).path
        if "%" in raw:
            try: raw = unquote(raw)
            except Exception: pass
        relative = PUBLIC.get(raw)
        if not relative: self.json(404, {"error": "Arquivo não encontrado."}); return
        target = ROOT / relative
        if not target.is_file(): self.json(404, {"error": "Arquivo não encontrado."}); return
        self.path = "/" + relative; self._cache = "no-store, max-age=0" if relative in {"index.html", "service-worker.js"} else "no-cache"; return super().do_GET()
    def send_header(self, keyword, value):
        if keyword.lower() == "cache-control" and getattr(self, "_cache", None): value = self._cache
        super().send_header(keyword, value)
    def dispatch(self, method):
        try:
            if urlsplit(self.path).path.startswith("/api/"): return self.api(method)
            if method == "GET": return self.static()
            raise ApiError(404, "Rota não encontrada.")
        except ApiError as error: self.json(error.status, {"error": str(error), **error.data})
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception as error: print("Internal error:", repr(error)); self.json(500, {"error": "Falha interna do servidor."})
    def do_GET(self): return self.dispatch("GET")
    def do_POST(self): return self.dispatch("POST")
    def do_PUT(self): return self.dispatch("PUT")


class TeamServer(ThreadingHTTPServer):
    daemon_threads = True; allow_reuse_address = True
    def __init__(self, address, store): self.store = store; super().__init__(address, Handler)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--host", default="0.0.0.0"); parser.add_argument("--port", type=int, default=8765); parser.add_argument("--no-browser", action="store_true"); parser.add_argument("--data-dir"); args = parser.parse_args()
    store = Store(Path(args.data_dir) if args.data_dir else ROOT.parent / "GameForge_Flow_Data"); server = TeamServer((args.host, args.port), store); url = f"http://localhost:{server.server_port}/#host={store.host_key}"
    print(f"\nGameForge Flow v0.9.0 em http://localhost:{server.server_port}"); print("Host local ativo. Use uma rede/VPN confiável ou um túnel HTTPS.\n")
    if not args.no_browser: threading.Timer(.7, lambda: webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
