"""Real loopback HTTP -> shipped client -> collector -> Office -> frontend codec."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from werkzeug.serving import make_server, WSGIRequestHandler
from flask import Flask, request, jsonify, redirect
from scripts.test_team_telemetry import TeamTelemetryTests, observation, WRITER, READER
from examples.team_api_client import TeamAPIClient, TelemetryError
from backend.office_team_collector import TeamCollector
from backend.office_api import register_office_api
from backend.office_store import OfficeStore


class QuietHandler(WSGIRequestHandler):
    def log_request(self,*args,**kwargs):
        pass


class HTTPIntegrationTests(TeamTelemetryTests):
    # Reuse only setUp/helpers, without rerunning the parent cases in this module.
    def test_real_http_client_and_deployed_frontend_contract(self):
        server=make_server("127.0.0.1",0,self.app,threaded=True,request_handler=QuietHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        origin=f"http://127.0.0.1:{server.server_port}"
        client=TeamAPIClient(origin,"company",WRITER)
        data=observation()
        self.assertTrue(client.publish(data)["created"])
        self.assertFalse(client.publish(data)["created"])
        with self.assertRaises(TelemetryError) as caught:
            TeamAPIClient(origin,"other",WRITER).publish(data)
        self.assertEqual(caught.exception.status,403)
        reader=self.root/"http-reader.json"
        reader.write_text(json.dumps([{"project_id":"company","key":READER}]))
        reader.chmod(0o600)
        mappings=[{"office_user_id":"1","project_id":"company","subject_id":"developer-1"}]
        mapped=self.root/"mapped.json";mapped.write_text(json.dumps(mappings))
        collector=TeamCollector(self.root/"office-http",origin,reader,mappings,allow_http=True)
        self.assertEqual(collector.collect_once()["connection"]["status"],"ok")
        store=OfficeStore(self.root/"office-http/office-config.sqlite3",allowed_user_ids=("1",))
        office=Flask("http-office")
        office.config.update(OFFICE_ENABLED=True,OFFICE_TELEMETRY_PROVIDER="standalone",OFFICE_SUBJECTS_FILE=str(mapped))
        register_office_api(office,store=store,snapshot_path=self.root/"office-http/office-snapshot.json")
        web=make_server("127.0.0.1",0,office,threaded=True,request_handler=QuietHandler)
        threading.Thread(target=web.serve_forever,daemon=True).start()
        self.addCleanup(web.server_close);self.addCleanup(web.shutdown)
        with urllib.request.urlopen(f"http://127.0.0.1:{web.server_port}/api/office/snapshot",timeout=3) as response:
            wire=json.load(response)
        fixture=self.root/"public.json";fixture.write_text(json.dumps(wire))
        repo=Path(__file__).resolve().parents[1]
        codec=Path(os.environ.get("OFFICE_CODEC_PATH",repo/"frontend/office/codec.mjs")).resolve()
        script="""import {readFileSync} from 'node:fs';
const {decodeSnapshot}=await import(process.env.AUDIT_CODEC_URL);
const wire=JSON.parse(readFileSync(process.env.AUDIT_WIRE_PATH));
const decoded=decodeSnapshot(wire);
const row=decoded.stations.find(s=>s.bound);
if(decoded.stations.length!==16 || row.status!=='working' || row.concurrency!=='3' ||
 row.todayUsage.total!=='9007199254740993' || row.activeModels.models[0].requests!=='3' ||
 row.activeModels.models[0].upstream_model!=='actual-model') throw new Error('codec mismatch');
console.log(JSON.stringify({stations:16,bound:decoded.stations.filter(s=>s.bound).length,status:row.status,tokenExact:true,models:true}));"""
        env={**os.environ,"AUDIT_CODEC_URL":codec.as_uri(),"AUDIT_WIRE_PATH":str(fixture)}
        process=subprocess.run(["node","--input-type=module","-e",script],env=env,text=True,capture_output=True,timeout=10)
        self.assertEqual(process.returncode,0,process.stderr)
        print("HTTP -> Office -> frontend:",process.stdout.strip())

    def test_http_client_retries_identical_bytes_and_refuses_redirects(self):
        fixture = Flask('retry-fixture')
        attempts, redirected = [], []

        @fixture.post('/api/v1/projects/<project>/telemetry')
        def publish(project):
            if project == 'redirect':
                return redirect('/sink', code=307)
            attempts.append((request.get_data(), request.headers.get('Idempotency-Key')))
            if len(attempts) == 1:
                return jsonify(error='temporary fixture failure'), 503
            return jsonify(accepted=True)

        @fixture.route('/sink', methods=['GET', 'POST'])
        def sink():
            redirected.append(True)
            return jsonify(accepted=True)

        server = make_server('127.0.0.1', 0, fixture, threaded=True, request_handler=QuietHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        origin = f'http://127.0.0.1:{server.server_port}'
        data = observation()
        with patch('examples.team_api_client.time.sleep'):
            self.assertTrue(TeamAPIClient(origin, 'company', WRITER).publish(data)['accepted'])
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(attempts[0][1], data['event_id'])
        with self.assertRaises(TelemetryError) as caught:
            TeamAPIClient(origin, 'redirect', WRITER).publish(data)
        self.assertEqual(caught.exception.status, 307)
        self.assertEqual(redirected, [])

    def test_gunicorn_workers_start_and_serialize_concurrent_retries(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        env = {**os.environ, 'API_DATA_FILE': str(self.root / 'gunicorn.sqlite3')}
        log_path = self.root / 'gunicorn.log'
        log = log_path.open('w')
        self.addCleanup(log.close)
        process = subprocess.Popen([sys.executable, '-m', 'gunicorn', '--workers', '2', '--threads', '4',
                                    '--bind', f'127.0.0.1:{port}', 'api_service.wsgi:app'],
                                   cwd=Path(__file__).resolve().parents[1], env=env,
                                   stdout=log, stderr=subprocess.STDOUT)
        def stop():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        self.addCleanup(stop)
        ready = False
        for _ in range(100):
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(origin + '/api/v1/readiness', timeout=0.2) as response:
                    ready = json.load(response)['ready']
                if ready:
                    break
            except OSError:
                pass
            time.sleep(0.05)
        self.assertTrue(ready, log_path.read_text()[-2000:])
        data = observation()
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda _: TeamAPIClient(origin, 'company', WRITER).publish(data), range(24)))
        self.assertEqual(sum(result['created'] for result in results), 1)
        self.assertTrue(all(result['accepted'] for result in results))
        self.assertIsNone(process.poll())
        print('Gunicorn: 2 workers, 24 concurrent requests, 1 created / 23 idempotent')


# Inherited tests are already covered by test_team_telemetry.
def load_tests(loader, tests, pattern):
    import unittest
    return unittest.TestSuite(HTTPIntegrationTests(name) for name in HTTPIntegrationTests.__dict__ if name.startswith('test_'))
