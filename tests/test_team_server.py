import copy
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("team_server", Path(__file__).resolve().parents[1] / "outputs/GameForge_Flow_v0.4/server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def project():
    return {"schemaVersion": 5, "id": "test-save", "name": "Test", "settings": {"sound": True},
            "docs": [{"id": "doc", "title": "Visao", "markdown": "# Test", "status": "draft"}],
            "production": [], "execution": [], "history": [],
            "members": [{"id": "vfx", "name": "Bia", "role": "Artist", "specialties": ["vfx"]},
                        {"id": "code", "name": "Leo", "role": "Programmer", "specialties": ["code"]}]}


class TeamServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gameforge-test-")
        self.store = server.Store(self.temp.name)
        self.host = server.TeamServer(("127.0.0.1", 0), self.store)
        self.thread = threading.Thread(target=self.host.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.host.server_port}"

    def tearDown(self):
        self.host.shutdown(); self.host.server_close(); self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", body=None, token=None, host=False, headers=None):
        hdr = dict(headers or {})
        if token: hdr["Authorization"] = "Bearer " + token
        if host: hdr["X-Host-Key"] = self.store.host_key
        data = None if body is None else json.dumps(body).encode()
        if data: hdr["Content-Type"] = "application/json"
        try:
            with urlopen(Request(self.base + path, data=data, method=method, headers=hdr), timeout=3) as reply:
                value = reply.read()
                return reply.status, json.loads(value) if "application/json" in reply.headers.get("Content-Type", "") else value
        except HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def create(self):
        status, value = self.request("/api/rooms", "POST", {"project": project()}, host=True)
        self.assertEqual(status, 201)
        return value

    def invite(self, room, member="vfx"):
        status, value = self.request(f'/api/rooms/{room["roomId"]}/invites', "POST", {"memberId": member}, token=room["token"])
        self.assertEqual(status, 201)
        return value["token"]

    def test_host_key_and_static_allowlist(self):
        self.assertEqual(self.request("/api/rooms", "POST", {"project": project()})[0], 403)
        self.assertEqual(self.request("/api/host")[0], 403)
        for path in ("/server.py", "/../GameForge_Flow_Data/host-key.txt", "/%2e%2e/host-key.txt", "/src/"):
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request("/app.js?v=test")[0], 200)
        self.assertEqual(self.request("/api/info")[0], 200)

    def test_two_clients_read_and_update_same_room(self):
        room = self.create(); token = self.invite(room)
        route = '/api/rooms/' + room['roomId']
        status, guest = self.request(route, token=token)
        self.assertEqual(status, 200)
        self.assertFalse(guest["principal"]["admin"])
        guest["project"]["docs"][0]["markdown"] = "Atualizado por Bia"
        status, result = self.request(route, "PUT", {"revision": 1, "project": guest["project"]}, token=token)
        self.assertEqual(status, 200); self.assertEqual(result["revision"], 2)
        self.assertEqual(self.request(route, token=room["token"])[1]["project"]["docs"][0]["markdown"], "Atualizado por Bia")

    def test_stale_write_is_rejected_without_losing_first_write(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        draft = copy.deepcopy(room["project"]); draft["name"] = "Primeiro"
        self.assertEqual(self.request(route, "PUT", {"revision": 1, "project": draft}, token=room["token"])[0], 200)
        draft["name"] = "Segundo"
        self.assertEqual(self.request(route, "PUT", {"revision": 1, "project": draft}, token=room["token"])[0], 409)
        self.assertEqual(self.request(route, token=room["token"])[1]["project"]["name"], "Primeiro")

    def test_simultaneous_writes_commit_exactly_once(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        barrier = threading.Barrier(2)
        def write(name):
            changed = copy.deepcopy(room['project']); changed['name'] = name
            barrier.wait()
            return self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0]
        with ThreadPoolExecutor(max_workers=2) as workers:
            statuses = list(workers.map(write, ['A', 'B']))
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(self.request(route, token=room['token'])[1]['revision'], 2)

    def test_member_cannot_manage_team_or_other_room(self):
        room = self.create(); token = self.invite(room); other = self.create()
        route = '/api/rooms/' + room['roomId']
        self.assertEqual(self.request('/api/rooms/' + other['roomId'], token=token)[0], 403)
        changed = copy.deepcopy(room['project']); changed['members'][0]['role'] = 'Admin'
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=token)[0], 403)
        self.assertEqual(self.request(route + '/invites', 'POST', {'memberId': 'code'}, token=token)[0], 403)

    def test_removing_member_revokes_invite_even_if_readded(self):
        room = self.create(); token = self.invite(room); route = '/api/rooms/' + room['roomId']
        changed = copy.deepcopy(room['project']); changed['members'] = changed['members'][1:]
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 200)
        self.assertEqual(self.request(route, token=token)[0], 403)
        self.assertEqual(self.request(route, 'PUT', {'revision': 2, 'project': room['project']}, token=room['token'])[0], 200)
        self.assertEqual(self.request(route, token=token)[0], 403)

    def test_regenerating_invite_revokes_previous_token(self):
        room = self.create(); old = self.invite(room); new = self.invite(room)
        route = '/api/rooms/' + room['roomId']
        self.assertEqual(self.request(route, token=old)[0], 403)
        self.assertEqual(self.request(route, token=new)[0], 200)

    def test_persistence_and_revision_history_survive_reopening_store(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        changed = copy.deepcopy(room['project']); changed['name'] = 'Persistente'
        self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])
        reopened = server.Store(self.temp.name)
        self.assertEqual(reopened.read(room['roomId'], room['token'])['project']['name'], 'Persistente')
        with reopened.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM versions').fetchone()[0], 2)
            self.assertNotIn(room['token'], db.execute('SELECT owner_hash FROM rooms').fetchone()[0])

    def test_creative_handoff_survives_shared_save_roundtrip_and_production_review(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        changed = copy.deepcopy(room['project'])
        item = {'id': 'handoff', 'text': 'Portal', 'description': '## Intenção\n\n**Descoberta**',
                'contentLayout': 'title-description', 'category': 'unclassified', 'status': 'inbox',
                'priority': 'high', 'suggestedPriority': 'high', 'creativeStatus': 'experiment',
                'assigneeId': None, 'assignee': 'Não atribuído', 'deadline': 'Sem prazo',
                'sourceDocumentId': 'doc', 'sourceDocumentTitle': 'Visao', 'sourceRevision': 3, 'sourceExcerpt': 'Texto original'}
        changed['production'] = [item]
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 200)
        status, result = self.request(route, token=room['token'])
        self.assertEqual(status, 200); self.assertEqual(result['project']['production'][0], item)
        self.assertEqual(result['project']['docs'][0]['status'], 'draft')
        item.update(category='vfx', priority='low', assigneeId='vfx', deadline='3 dias', status='ready')
        self.assertEqual(self.request(route, 'PUT', {'revision': 2, 'project': changed}, token=room['token'])[0], 200)
        final = self.request(route, token=room['token'])[1]['project']['production'][0]
        self.assertEqual(final['priority'], 'low'); self.assertEqual(final['suggestedPriority'], 'high')
        self.assertEqual(final['creativeStatus'], 'experiment'); self.assertEqual(final['assignee'], 'Bia')

    def test_unclassified_is_not_a_team_specialty_or_execution_category(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        changed = copy.deepcopy(room['project']); changed['members'][0]['specialties'] = ['unclassified']
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 400)
        changed = copy.deepcopy(room['project'])
        changed['execution'] = [{'id':'task', 'text':'Texto', 'priority':'normal', 'category':'unclassified', 'status':'todo'}]
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 400)
        for field, value in [('creativeStatus', 'ready'), ('suggestedPriority', 'urgent')]:
            changed = copy.deepcopy(room['project'])
            changed['production'] = [{'id':'handoff', 'text':'Texto', 'priority':'normal', 'category':'unclassified', 'status':'inbox', field:value}]
            self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 400)

    def test_invalid_json_schema_origin_and_foreign_assignee(self):
        room = self.create(); route = '/api/rooms/' + room['roomId']
        self.assertEqual(self.request(route, headers={'Origin': 'https://untrusted.example'}, token=room['token'])[0], 403)
        changed = copy.deepcopy(room['project']); changed['docs'][0]['id'] = '" onclick="'
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 400)
        changed = copy.deepcopy(room['project'])
        changed['execution'] = [{'id': 'task', 'text': 'VFX', 'category': 'vfx', 'priority': 'normal', 'status': 'todo', 'assigneeId': 'outsider'}]
        self.assertEqual(self.request(route, 'PUT', {'revision': 1, 'project': changed}, token=room['token'])[0], 400)


if __name__ == '__main__':
    unittest.main()
