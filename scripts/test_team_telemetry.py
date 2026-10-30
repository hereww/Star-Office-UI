"""Meaningful protocol and Office integration regressions; all data is disposable."""
import copy
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from flask import Flask
from api_service.app import create_app
from api_service.store import StateStore
from backend.office_api import register_office_api
from backend.office_collector import read_snapshot
from backend.office_team_collector import TeamCollector
from backend.office_store import OfficeStore
from backend.team_telemetry import normalize_observation, qualities

WRITER = "fixture-writer-"+"a"*32
READER = "fixture-reader-"+"b"*32
OTHER = "fixture-other-"+"c"*32


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00","Z")


def observation(subject="developer-1", event="event-1", now=None):
    now = now or datetime.now(timezone.utc)-timedelta(seconds=1)
    stamp = iso(now)
    return {"schema_version":1,"event_id":event,"subject_id":subject,"observed_at":stamp,"service_state":"ready",
            "identity":{"name":"研发同事","quality":"fresh","observed_at":stamp},
            "concurrency":{"current":3,"limit":20,"quality":"fresh","observed_at":stamp},
            "today_usage":{"total":"9007199254740993","date":now.astimezone(ZoneInfo("Asia/Shanghai")).date().isoformat(),
                           "timezone":"Asia/Shanghai","window_end":stamp,"quality":"fresh","observed_at":stamp},
            "active_models":{"models":[{"requested_model":"company-model","upstream_model":"actual-model","requests":"3"}],
                             "quality":"partial","observed_at":stamp}}


class TeamTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.keys = self.root/"project-keys.json"
        self.keys.write_text(json.dumps([
            {"project_id":"company","key":WRITER,"permissions":["telemetry:write"]},
            {"project_id":"company","key":READER,"permissions":["telemetry:read"]},
            {"project_id":"other","key":OTHER,"permissions":["telemetry:write","telemetry:read"]}]))
        self.keys.chmod(0o600)
        self.env = patch.dict(os.environ,{"API_AUTH_MODE":"key","API_PROJECT_KEYS_FILE":str(self.keys),
                                         "API_SERVICE_KEY":"","API_KEY_FILE":"","OFFICE_TELEMETRY_PROVIDER":"sub2api"})
        self.env.start(); self.addCleanup(self.env.stop)
        self.store = StateStore(self.root/"api.sqlite3")
        self.app = create_app(store=self.store,testing=True)
        self.client = self.app.test_client()

    def post(self, body, key=WRITER, project="company", client=None):
        return (client or self.client).post("/api/v1/projects/"+project+"/telemetry",json=body,
                                           headers={"Authorization":"Bearer "+key})

    def snapshot(self, key=READER, project="company"):
        return self.client.get("/api/v1/projects/"+project+"/snapshot",headers={"Authorization":"Bearer "+key})

    def test_authentication_and_project_permissions(self):
        self.assertEqual(self.post(observation(),key="").status_code,401)
        self.assertEqual(self.post(observation(),key=READER).status_code,403)
        self.assertEqual(self.snapshot(key=WRITER).status_code,403)
        self.assertEqual(self.post(observation(),project="other").status_code,403)
        self.assertEqual(self.snapshot(key=OTHER).status_code,403)
        self.assertEqual(self.client.get("/api/v1/health").status_code,200)

    def test_exact_values_and_semantic_idempotency(self):
        body=observation()
        self.assertEqual(self.post(body).status_code,201)
        reordered={k:body[k] for k in reversed(body)}
        self.assertEqual(self.post(reordered).status_code,200)
        wire=self.snapshot().get_json()
        self.assertTrue(wire["complete"])
        self.assertEqual(wire["subjects"][0]["today_usage"]["total"],"9007199254740993")
        self.assertEqual(wire["subjects"][0]["active_models"]["models"][0]["requests"],"3")
        body["concurrency"]["current"]=4
        self.assertEqual(self.post(body).status_code,409)

    def test_parallel_retries_never_return_500(self):
        body=observation()
        barrier=threading.Barrier(12)
        def send(_):
            with self.app.test_client() as c:
                barrier.wait()
                return self.post(body,client=c).status_code
        with ThreadPoolExecutor(max_workers=12) as pool:statuses=list(pool.map(send,range(12)))
        self.assertEqual(statuses.count(201),1)
        self.assertEqual(statuses.count(200),11)

    def test_projects_do_not_share_subjects_or_event_ids(self):
        body=observation()
        self.assertEqual(self.post(body).status_code,201)
        body["identity"]["name"]="other project"
        self.assertEqual(self.post(body,key=OTHER,project="other").status_code,201)
        self.assertEqual(self.snapshot().get_json()["subjects"][0]["identity"]["name"],"研发同事")
        self.assertEqual(self.snapshot(key=OTHER,project="other").get_json()["subjects"][0]["identity"]["name"],"other project")

    def test_out_of_order_and_fractional_second_ordering(self):
        t=(datetime.now(timezone.utc)-timedelta(seconds=2)).replace(microsecond=0)
        old=observation(event="old",now=t)
        new=observation(event="new",now=t+timedelta(microseconds=1))
        new["concurrency"]["current"]=7
        self.assertTrue(self.post(new).get_json()["applied"])
        self.assertFalse(self.post(old).get_json()["applied"])
        self.assertEqual(self.snapshot().get_json()["subjects"][0]["concurrency"]["current"],7)
        different=copy.deepcopy(new);different["event_id"]="same-time";different["concurrency"]["current"]=6
        self.assertEqual(self.post(different).status_code,409)

    def test_each_subject_and_metric_expires_independently(self):
        now=datetime.now(timezone.utc)-timedelta(seconds=1)
        old=observation("old","old",now-timedelta(hours=1))
        new=observation("new","new",now)
        new["concurrency"]["observed_at"]=iso(now-timedelta(minutes=1))
        self.post(old);self.post(new)
        rows={s["subject_id"]:s for s in self.snapshot().get_json()["subjects"]}
        self.assertEqual(rows["old"]["freshness"]["heartbeat"],"stale")
        self.assertEqual(rows["new"]["freshness"]["heartbeat"],"fresh")
        self.assertEqual(rows["new"]["freshness"]["concurrency"],"stale")
        self.assertEqual(rows["new"]["freshness"]["today_usage"],"fresh")

    def test_heartbeat_does_not_require_business_state_change(self):
        now=datetime.now(timezone.utc)-timedelta(seconds=2)
        self.post(observation(now=now))
        self.assertTrue(self.post(observation(event="heartbeat",now=now+timedelta(seconds=1))).get_json()["applied"])

    def test_invalid_fields_types_and_nonfinite_numbers(self):
        cases=[]
        b=observation();b["identity"]["email"]="must-not-store@example.invalid";cases.append(b)
        b=observation();b["concurrency"]["current"]=True;cases.append(b)
        b=observation();b["concurrency"]["current"]=float("nan");cases.append(b)
        b=observation();b["today_usage"]["total"]=9007199254740993;cases.append(b)
        b=observation();b["active_models"]["models"][0]["requests"]="0";cases.append(b)
        b=observation();b["active_models"]["models"][0]["upstream_model"]=" model ";cases.append(b)
        b=observation();b["concurrency"]["observed_at"]=iso(datetime.now(timezone.utc)+timedelta(days=1));cases.append(b)
        b=observation();b["identity"]["quality"]="unavailable";cases.append(b)
        for b in cases:
            with self.subTest(body=b):self.assertEqual(self.post(b).status_code,400)
        self.assertEqual(self.snapshot().get_json()["subjects"],[])

    def test_beijing_midnight_does_not_relabel_yesterdays_total(self):
        before=datetime(2026,10,30,23,59,59,tzinfo=ZoneInfo("Asia/Shanghai"))
        body=observation(now=before)
        self.assertEqual(qualities(body,(before+timedelta(seconds=2)).timestamp(),15)["today_usage"],"stale")

    def test_scope_capacity_returns_explicit_error_and_complete_snapshot(self):
        for n in range(500):self.store.append_observation("company",observation(str(n),"event-"+str(n)))
        self.assertEqual(self.post(observation("overflow","overflow")).status_code,409)
        snap=self.snapshot().get_json()
        self.assertTrue(snap["complete"]);self.assertEqual(len(snap["subjects"]),500)

    def test_readiness_checks_writability(self):
        self.store.path.chmod(0o400)
        try:self.assertEqual(self.client.get("/api/v1/readiness").status_code,503)
        finally:self.store.path.chmod(0o600)

    def test_complete_no_sub2api_office_pipeline_and_binding_preservation(self):
        body=observation()
        self.post(body)
        keys=self.root/"reader.json";keys.write_text(json.dumps([{"project_id":"company","key":READER}]))
        keys.chmod(0o600)
        mapping=[{"office_user_id":"1","project_id":"company","subject_id":"developer-1"}]
        mappings=self.root/"subjects.json";mappings.write_text(json.dumps(mapping))
        requests=[]
        def transport(url,headers,timeout):
            from urllib.parse import urlsplit
            requests.append(url)
            r=self.client.get(urlsplit(url).path,headers=headers)
            return r.status_code,r.data
        data=self.root/"office"
        collector=TeamCollector(data,"https://fixture.invalid",keys,mapping,transport=transport)
        raw=collector.collect_once()
        self.assertEqual(raw["connection"]["status"],"ok",raw)
        parsed=read_snapshot(data/"office-snapshot.json")
        self.assertEqual(parsed["connection"]["status"],"ok",parsed)
        store=OfficeStore(data/"office-config.sqlite3",allowed_user_ids=("1",))
        cfg=store.read_config()
        content={k:cfg[k] for k in ("bindings","display","collection","appearance","room_characters")}
        content["bindings"].append({**content["bindings"][0],"seat_id":"desk-14","display_name":"同一成员第二工位"})
        store.save_config(cfg["version"],content,allowed_new_user_ids={"1"})
        before=store.read_config()
        app=Flask("team-office-fixture")
        app.config.update(OFFICE_ENABLED=True,OFFICE_TELEMETRY_PROVIDER="standalone",OFFICE_SUBJECTS_FILE=str(mappings))
        register_office_api(app,store=store,snapshot_path=data/"office-snapshot.json")
        client=app.test_client()
        public=client.get("/api/office/snapshot").get_json()
        self.assertEqual(len(public["stations"]),16)
        self.assertEqual(public["summary"]["bound"],2)
        self.assertEqual(public["source"]["rack_state"],"working")
        for row in (x for x in public["stations"] if x["bound"]):
            self.assertEqual(row["concurrency"]["current"],3)
            self.assertEqual(row["today_usage"]["total"],"9007199254740993")
            self.assertEqual(row["active_models"]["models"][0]["requests"],"3")
            self.assertEqual(row["username"],"研发同事")
        self.assertEqual(before,store.read_config())
        self.assertTrue(all("/api/v1/projects/company/snapshot" in url for url in requests))
        self.assertNotIn("api_keys",json.dumps(public))
        # Read/auth failure clears previous observations without altering bindings.
        collector.transport=lambda *args:(401,b"")
        collector.collect_once()
        failed=client.get("/api/office/snapshot").get_json()
        self.assertTrue(all(x["concurrency"]["current"] is None for x in failed["stations"]))
        self.assertEqual(before,store.read_config())


if __name__=="__main__":
    unittest.main()
