"""GameForge Flow MCP server (stdio, JSON-RPC 2.0, no third-party dependencies)."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import copy, json, os, sys, time

from team_server import Store, ApiError, validate_project, SPECIALTIES, PRIORITIES, PROD_STATUSES, EXEC_STATUSES

VERSION = "0.9.0"
PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"}


def schema(properties=None, required=None):
    return {"type": "object", "properties": properties or {}, "required": required or [], "additionalProperties": False}


TOOLS = [
    {"name": "list_projects", "description": "Lista os Saves compartilhados disponíveis neste host GameForge Flow.", "inputSchema": schema(), "annotations": {"readOnlyHint": True, "idempotentHint": True}},
    {"name": "get_project_summary", "description": "Lê o resumo, as contagens e o estado atual de um Save.", "inputSchema": schema({"roomId": {"type": "string", "description": "Sala; opcional quando GAMEFORGE_ROOM_ID está configurado."}}), "annotations": {"readOnlyHint": True, "idempotentHint": True}},
    {"name": "list_team", "description": "Lista equipe, cargos, especialidades e permissões de um Save.", "inputSchema": schema({"roomId": {"type": "string"}}), "annotations": {"readOnlyHint": True, "idempotentHint": True}},
    {"name": "read_document", "description": "Lê um documento de Visão em Markdown.", "inputSchema": schema({"roomId": {"type": "string"}, "documentId": {"type": "string"}}, ["documentId"]), "annotations": {"readOnlyHint": True, "idempotentHint": True}},
    {"name": "create_demand", "description": "Cria uma demanda em Produção.", "inputSchema": schema({"roomId": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "category": {"type": "string", "enum": sorted(SPECIALTIES | {"unclassified"})}, "priority": {"type": "string", "enum": sorted(PRIORITIES)}, "deadline": {"type": "string"}}, ["title"]), "annotations": {"readOnlyHint": False, "destructiveHint": False}},
    {"name": "update_demand", "description": "Atualiza campos de uma demanda existente em Produção.", "inputSchema": schema({"roomId": {"type": "string"}, "demandId": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "category": {"type": "string", "enum": sorted(SPECIALTIES | {"unclassified"})}, "priority": {"type": "string", "enum": sorted(PRIORITIES)}, "status": {"type": "string", "enum": sorted(PROD_STATUSES)}, "deadline": {"type": "string"}, "assigneeId": {"type": ["string", "null"]}}, ["demandId"]), "annotations": {"readOnlyHint": False, "destructiveHint": False}},
    {"name": "create_task", "description": "Cria uma tarefa na Execução.", "inputSchema": schema({"roomId": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "category": {"type": "string", "enum": sorted(SPECIALTIES)}, "priority": {"type": "string", "enum": sorted(PRIORITIES)}, "deadline": {"type": "string"}, "assigneeId": {"type": ["string", "null"]}}, ["title"]), "annotations": {"readOnlyHint": False, "destructiveHint": False}},
    {"name": "update_task", "description": "Atualiza campos de uma tarefa existente na Execução.", "inputSchema": schema({"roomId": {"type": "string"}, "taskId": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "category": {"type": "string", "enum": sorted(SPECIALTIES)}, "priority": {"type": "string", "enum": sorted(PRIORITIES)}, "status": {"type": "string", "enum": sorted(EXEC_STATUSES)}, "deadline": {"type": "string"}, "assigneeId": {"type": ["string", "null"]}}, ["taskId"]), "annotations": {"readOnlyHint": False, "destructiveHint": False}},
    {"name": "add_comment", "description": "Adiciona um comentário identificado como MCP a um documento, demanda ou tarefa.", "inputSchema": schema({"roomId": {"type": "string"}, "targetType": {"type": "string", "enum": ["doc", "production", "execution"]}, "targetId": {"type": "string"}, "text": {"type": "string"}}, ["targetType", "targetId", "text"]), "annotations": {"readOnlyHint": False, "destructiveHint": False}},
]


class GameForgeMCP:
    def __init__(self):
        default_data = Path(__file__).resolve().parent.parent / "GameForge_Flow_Data"
        self.store = Store(os.environ.get("GAMEFORGE_DATA_DIR") or default_data)
        self.default_room = os.environ.get("GAMEFORGE_ROOM_ID", "")
        configured_key = os.environ.get("GAMEFORGE_HOST_KEY", "")
        self.write_enabled = bool(configured_key) and secrets_equal(configured_key, self.store.host_key)

    def room_id(self, args):
        room_id = args.get("roomId") or self.default_room
        if not room_id: raise ApiError(400, "Informe roomId ou configure GAMEFORGE_ROOM_ID.")
        return room_id

    def read_room(self, room_id):
        with self.store.connect() as db:
            row = self.store._room(db, room_id)
            return row, json.loads(row["project_json"])

    def write(self, room_id, action):
        if not self.write_enabled: raise ApiError(403, "Escrita MCP bloqueada. Configure GAMEFORGE_HOST_KEY com a chave deste host.")
        with self.store.lock, self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE"); row = self.store._room(db, room_id); project = json.loads(row["project_json"]); result = action(project); row = self.store._commit(db, row, validate_project(project)); revision = row["revision"]
        self.store._signal(room_id)
        return {"revision": revision, **(result or {})}

    def call(self, name, args):
        if name == "list_projects":
            with self.store.connect() as db:
                return {"projects": [{"roomId": row["room_id"], "name": row["name"], "revision": row["revision"]} for row in db.execute("SELECT room_id,name,revision FROM rooms ORDER BY updated DESC")]}
        room_id = self.room_id(args)
        if name == "get_project_summary":
            row, project = self.read_room(room_id)
            return {"roomId": room_id, "revision": row["revision"], "id": project["id"], "name": project["name"], "counts": {"documents": len(project["docs"]), "demands": len(project["production"]), "tasks": len(project["execution"]), "members": len(project["members"])}, "updatedAt": project.get("updatedAt")}
        if name == "list_team":
            _, project = self.read_room(room_id); return {"roomId": room_id, "members": project["members"]}
        if name == "read_document":
            _, project = self.read_room(room_id); doc = find(project["docs"], args["documentId"], "Documento"); return {"roomId": room_id, "document": doc}
        if name == "create_demand":
            def action(project):
                stamp = iso_now(); item = {"id": make_id(), "projectId": project["id"], "parentId": None, "sourceDocumentId": None, "sourceDocumentTitle": "MCP", "sourceRevision": None, "sourceExcerpt": "", "text": args["title"].strip() or "Nova demanda", "description": args.get("description", ""), "contentLayout": "title-description", "category": args.get("category", "unclassified"), "status": "inbox", "priority": args.get("priority", "normal"), "estimate": "", "deadline": args.get("deadline", "Sem prazo"), "tags": ["mcp"], "dependencies": [], "subtasks": [], "assigneeId": None, "assignee": "Não atribuído", "attachments": [], "comments": [], "createdAt": stamp, "updatedAt": stamp}; project["production"].append(item); history(project, "MCP_DEMAND_CREATED", f"MCP criou a demanda “{item['text']}”"); return {"demand": item}
            return self.write(room_id, action)
        if name == "update_demand":
            def action(project):
                item = find(project["production"], args["demandId"], "Demanda"); apply_fields(item, args, {"title": "text", "description": "description", "category": "category", "priority": "priority", "status": "status", "deadline": "deadline", "assigneeId": "assigneeId"}); assign(project, item); item["updatedAt"] = iso_now(); history(project, "MCP_DEMAND_UPDATED", f"MCP atualizou a demanda “{item['text']}”"); return {"demand": item}
            return self.write(room_id, action)
        if name == "create_task":
            def action(project):
                stamp = iso_now(); category = args.get("category", "design"); item = {"id": make_id(), "projectId": project["id"], "productionItemId": None, "visionDocumentId": None, "text": args["title"].strip() or "Nova tarefa", "description": args.get("description", ""), "category": category, "department": category, "assigneeId": args.get("assigneeId"), "assignee": "Não atribuído", "status": "todo", "priority": args.get("priority", "normal"), "deadline": args.get("deadline", "Sem prazo"), "dependencies": [], "subtasks": [], "attachments": [], "comments": [], "createdAt": stamp, "updatedAt": stamp}; assign(project, item); project["execution"].append(item); history(project, "MCP_TASK_CREATED", f"MCP criou a tarefa “{item['text']}”"); return {"task": item}
            return self.write(room_id, action)
        if name == "update_task":
            def action(project):
                item = find(project["execution"], args["taskId"], "Tarefa"); apply_fields(item, args, {"title": "text", "description": "description", "category": "category", "priority": "priority", "status": "status", "deadline": "deadline", "assigneeId": "assigneeId"}); item["department"] = item["category"]; assign(project, item); item["updatedAt"] = iso_now(); history(project, "MCP_TASK_UPDATED", f"MCP atualizou a tarefa “{item['text']}”"); return {"task": item}
            return self.write(room_id, action)
        if name == "add_comment":
            def action(project):
                collections = {"doc": "docs", "production": "production", "execution": "execution"}; target = find(project[collections[args["targetType"]]], args["targetId"], "Conteúdo"); text = str(args["text"]).strip()
                if not text or len(text) > 4000: raise ApiError(400, "Comentário inválido.")
                comment = {"id": make_id(), "text": text, "authorId": None, "author": "MCP", "createdAt": iso_now()}; target.setdefault("comments", []).append(comment); history(project, "MCP_COMMENT_ADDED", f"MCP comentou em “{target.get('title') or target.get('text')}”"); return {"comment": comment}
            return self.write(room_id, action)
        raise ApiError(404, "Ferramenta MCP não encontrada.")

    def resources(self):
        projects = self.call("list_projects", {})["projects"]
        return [{"uri": f"gameforge://room/{row['roomId']}", "name": row["name"], "description": f"Save GameForge Flow · revisão {row['revision']}", "mimeType": "application/json"} for row in projects]

    def read_resource(self, uri):
        parsed = urlsplit(uri)
        if parsed.scheme != "gameforge" or parsed.netloc != "room": raise ApiError(400, "URI GameForge inválida.")
        parts = [unquote(value) for value in parsed.path.split("/") if value]
        if not parts: raise ApiError(400, "Sala ausente na URI.")
        _, project = self.read_room(parts[0])
        if len(parts) == 1: value, mime = project, "application/json"
        elif len(parts) == 3 and parts[1] == "docs": value, mime = find(project["docs"], parts[2], "Documento")["markdown"], "text/markdown"
        else: raise ApiError(404, "Recurso não encontrado.")
        return {"contents": [{"uri": uri, "mimeType": mime, "text": value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)}]}

    def handle(self, request):
        method = request.get("method", ""); params = request.get("params") or {}
        if method == "initialize":
            requested = params.get("protocolVersion"); protocol = requested if requested in PROTOCOLS else "2026-07-28"
            return {"protocolVersion": protocol, "capabilities": {"tools": {"listChanged": False}, "resources": {"subscribe": False, "listChanged": False}}, "serverInfo": {"name": "gameforge-flow", "title": "GameForge Flow", "version": VERSION}, "instructions": "Use ferramentas de leitura livremente. Confirme alterações importantes com a pessoa antes de executar ferramentas de escrita."}
        if method == "ping": return {}
        if method == "tools/list": return {"tools": TOOLS}
        if method == "tools/call":
            value = self.call(params.get("name", ""), params.get("arguments") or {}); text = json.dumps(value, ensure_ascii=False, indent=2)
            return {"content": [{"type": "text", "text": text}], "structuredContent": value, "isError": False}
        if method == "resources/list": return {"resources": self.resources()}
        if method == "resources/templates/list": return {"resourceTemplates": [{"uriTemplate": "gameforge://room/{roomId}/docs/{documentId}", "name": "Documento de Visão", "mimeType": "text/markdown"}]}
        if method == "resources/read": return self.read_resource(params.get("uri", ""))
        if method.startswith("notifications/"): return None
        raise ApiError(-32601, f"Método não encontrado: {method}")


def secrets_equal(left, right):
    import hmac
    return hmac.compare_digest(left, right)


def make_id():
    import secrets
    return secrets.token_urlsafe(10)


def iso_now(): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def find(rows, value, label):
    item = next((row for row in rows if row.get("id") == value), None)
    if not item: raise ApiError(404, f"{label} não encontrado.")
    return item


def apply_fields(item, args, mapping):
    for source, target in mapping.items():
        if source in args: item[target] = args[source]


def assign(project, item):
    member_id = item.get("assigneeId")
    if member_id is None: item["assignee"] = "Não atribuído"; return
    member = find(project["members"], member_id, "Responsável"); item["assignee"] = member["name"]


def history(project, kind, message):
    project.setdefault("history", []).insert(0, {"id": make_id(), "type": kind, "message": message, "actor": "MCP", "at": iso_now(), "meta": {}}); project["history"] = project["history"][:300]; project["updatedAt"] = iso_now()


def error_result(request_id, code, message, data=None):
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message, **({"data": data} if data else {})}}


def main():
    server = GameForgeMCP()
    for line in sys.stdin:
        try:
            request = json.loads(line); request_id = request.get("id"); result = server.handle(request)
            if request_id is None or result is None: continue
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except ApiError as error:
            response = error_result(locals().get("request", {}).get("id"), error.status if error.status < 0 else -32000, str(error), error.data)
        except Exception as error:
            response = error_result(locals().get("request", {}).get("id"), -32603, "Erro interno do MCP.", {"detail": str(error)})
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n"); sys.stdout.flush()


if __name__ == "__main__": main()
