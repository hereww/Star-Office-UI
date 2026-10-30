#!/usr/bin/env python3
"""Provision new local service credentials without printing secrets or overwriting files."""
import argparse
import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.team_telemetry import identifier


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",default=".local/team-api")
    parser.add_argument("--project",default="company")
    parser.add_argument("--subject",default="developer-1")
    args=parser.parse_args()
    project,subject=identifier(args.project),identifier(args.subject)
    directory=Path(args.output).resolve()
    names=["api-project-keys.json","office-reader-keys.json","office-subjects.json","producer.json"]
    if any((directory/name).exists() for name in names):
        parser.error("configuration already exists; use a new output directory")
    os.umask(0o077);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    writer,reader=secrets.token_urlsafe(32),secrets.token_urlsafe(32)
    data=[
        [{"project_id":project,"key":writer,"permissions":["telemetry:write"]},
         {"project_id":project,"key":reader,"permissions":["telemetry:read"]}],
        [{"project_id":project,"key":reader}],
        [{"office_user_id":"1","project_id":project,"subject_id":subject}],
        {"project_id":project,"subject_id":subject,"key":writer}]
    for name,value in zip(names,data):
        with (directory/name).open("x",encoding="utf-8") as stream:
            json.dump(value,stream,ensure_ascii=False,indent=2);stream.write("\n")
        print(directory/name)


if __name__=="__main__":
    main()
