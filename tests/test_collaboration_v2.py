import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "outputs/GameForge_Flow_v0.4"
spec = importlib.util.spec_from_file_location("gameforge_server_v2", APP / "server.py")
server = importlib.util.module_from_spec(spec); spec.loader.exec_module(server)


def sample():
    return {"schemaVersion": 5, "id": "project", "name": "Project", "settings": {"sound": True},
            "docs": [{"id": "doc", "title": "Vision", "markdown": "# Vision", "status": "draft", "comments": [], "attachments": []}],
            "production": [], "execution": [], "history": [],
            "members": [{"id": "artist", "name": "Ana", "role": "Artist", "specialties": ["vfx"], "permissions": ["vision", "comments", "files"]}]}


class CollaborationV2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gameforge-v2-"); self.store = server.Store(self.temp.name); self.room = self.store.create(sample()); self.token = self.store.invite(self.room["roomId"], self.room["token"], "artist")["token"]

    def tearDown(self): self.temp.cleanup()

    def test_identity_and_granular_permissions(self):
        snapshot = self.store.read(self.room["roomId"], self.token)
        self.assertEqual(snapshot["principal"]["name"], "Ana"); self.assertIn("vision", snapshot["principal"]["permissions"])
        changed = copy.deepcopy(snapshot["project"]); changed["docs"][0]["markdown"] = "Allowed"
        self.assertEqual(self.store.update(self.room["roomId"], self.token, 1, changed)["revision"], 2)
        changed = copy.deepcopy(self.store.read(self.room["roomId"], self.token)["project"]); changed["production"].append({"id": "demand", "text": "Denied", "category": "vfx", "status": "inbox", "priority": "normal"})
        with self.assertRaises(server.ApiError) as denied: self.store.update(self.room["roomId"], self.token, 2, changed)
        self.assertEqual(denied.exception.status, 403)

    def test_presence_comments_and_files_share_one_revision_stream(self):
        presence = self.store.set_presence(self.room["roomId"], self.token, {"clientId": "browser-a", "stage": "vision", "editing": "Vision"})
        event = self.store.events(self.room["roomId"], self.room["token"], 1, 0, wait=0)
        self.assertGreaterEqual(event["eventId"], presence["eventId"]); self.assertEqual(event["presence"][0]["name"], "Ana")
        result = self.store.add_comment(self.room["roomId"], self.token, 1, "doc", "doc", "Boa direção")
        self.assertEqual(result["snapshot"]["revision"], 2); self.assertEqual(result["comment"]["author"], "Ana")
        uploaded = self.store.add_file(self.room["roomId"], self.token, 2, "doc", "doc", "brief.txt", "text/plain", base64.b64encode(b"brief").decode())
        path, metadata = self.store.read_file(self.room["roomId"], self.token, uploaded["attachment"]["id"])
        self.assertEqual(path.read_bytes(), b"brief"); self.assertEqual(metadata["name"], "brief.txt"); self.assertEqual(uploaded["snapshot"]["revision"], 3)

    def test_mcp_stdio_lists_tools_reads_and_writes_the_same_save(self):
        env = {**os.environ, "GAMEFORGE_DATA_DIR": self.temp.name, "GAMEFORGE_ROOM_ID": self.room["roomId"], "GAMEFORGE_HOST_KEY": self.store.host_key}
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "create_demand", "arguments": {"title": "MCP demand", "category": "vfx"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "resources/list", "params": {}}
        ]
        process = subprocess.run([os.fspath(Path(os.sys.executable)), os.fspath(APP / "mcp_server.py")], input="".join(json.dumps(row) + "\n" for row in requests), text=True, capture_output=True, env=env, timeout=8, check=True)
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(replies[0]["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("add_comment", [tool["name"] for tool in replies[1]["result"]["tools"]])
        self.assertEqual(replies[2]["result"]["structuredContent"]["demand"]["text"], "MCP demand")
        self.assertEqual(len(replies[3]["result"]["resources"]), 1)
        with self.store.connect() as db: saved = json.loads(db.execute("SELECT project_json FROM rooms").fetchone()[0])
        self.assertEqual(saved["production"][0]["text"], "MCP demand")


if __name__ == "__main__": unittest.main()
