#!/usr/bin/env python3
"""Audit candidate CPython 3.11 Linux/glibc x86_64 wheels; never install.
Run with the existing venv (pip's vendored packaging is reused).
Network is explicit: --pypi verifies official HTTPS PyPI hashes.
"""
from __future__ import annotations
import argparse
import base64
import csv
from datetime import datetime, timezone
from email.parser import BytesParser
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener
import zipfile
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.tags import compatible_tags, cpython_tags, parse_tag
from pip._vendor.packaging.utils import canonicalize_name, parse_wheel_filename
from pip._vendor.packaging.version import Version

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PLATFORMS = ['manylinux2014_x86_64', 'manylinux_2_17_x86_64']
TARGET = {
    'implementation_name': 'cpython', 'implementation_version': '3.11.0',
    'os_name': 'posix', 'platform_machine': 'x86_64', 'platform_release': '',
    'platform_system': 'Linux', 'platform_version': '', 'python_full_version': '3.11.0',
    'platform_python_implementation': 'CPython', 'python_version': '3.11',
    'sys_platform': 'linux', 'extra': '',
}

def require(condition, message):
    if not condition:
        raise ValueError(message)


def official_url(url):
    parts = urlsplit(url)
    require(parts.scheme == 'https' and parts.hostname in {'pypi.org', 'files.pythonhosted.org'}
            and parts.port in (None, 443) and not parts.username and not parts.password,
            'non-official or non-HTTPS PyPI URL rejected')


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def audit(check_pypi):
    accepted = set(cpython_tags(python_version=(3, 11), abis=['cp311'], platforms=PLATFORMS))
    accepted.update(compatible_tags(python_version=(3, 11), interpreter='cp311', platforms=PLATFORMS))
    packages = {}
    records = []
    opener = build_opener(HTTPSHandler(), OfficialRedirect())
    wheels = sorted(HERE.glob('*.whl'))
    require(bool(wheels), 'wheelhouse is empty')
    for path in wheels:
        require(not path.is_symlink(), 'wheel symlinks rejected')
        name, version, _, filename_tags = parse_wheel_filename(path.name)
        require(bool(filename_tags & accepted), 'wrong candidate tags: ' + path.name)
        with zipfile.ZipFile(path) as archive:
            paths = archive.namelist()
            require(len(paths) == len(set(paths)), 'duplicate archive entries')
            require(all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts
                        and '\\' not in n for n in paths), 'unsafe archive entry')
            require(archive.testzip() is None, 'wheel CRC validation failed')
            metadata_paths = [n for n in paths if n.endswith('.dist-info/METADATA')]
            require(len(metadata_paths) == 1, 'expected single METADATA')
            prefix = metadata_paths[0].rsplit('/', 1)[0]
            metadata = BytesParser().parsebytes(archive.read(metadata_paths[0]))
            wheel = BytesParser().parsebytes(archive.read(prefix + '/WHEEL'))
            embedded_tags = set().union(*(parse_tag(t) for t in wheel.get_all('Tag', [])))
            require(embedded_tags == filename_tags, 'WHEEL tags differ from filename')
            require(canonicalize_name(metadata['Name']) == name and Version(metadata['Version']) == version,
                    'METADATA name/version differs from filename')
            requires_python = metadata.get('Requires-Python')
            if requires_python:
                from pip._vendor.packaging.specifiers import SpecifierSet
                require(SpecifierSet(requires_python).contains(TARGET['python_full_version']),
                        'Requires-Python excludes CPython 3.11')
            record_checks = 0
            for member, encoded_hash, size in csv.reader(io.StringIO(archive.read(prefix + '/RECORD').decode())):
                if not encoded_hash:
                    require(member == prefix + '/RECORD', 'unexpected unhashed RECORD member')
                    continue
                algorithm, expected = encoded_hash.split('=', 1)
                require(algorithm == 'sha256', 'unexpected RECORD hash algorithm')
                content = archive.read(member)
                actual = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b'=').decode()
                require(actual == expected and len(content) == int(size), 'RECORD hash/size mismatch')
                record_checks += 1
        require(name not in packages, 'duplicate package versions')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        record = {
            'name': str(name), 'version': str(version), 'file': path.name,
            'bytes': path.stat().st_size, 'sha256': digest,
            'tags': sorted(str(t) for t in filename_tags), 'requires_python': requires_python,
            'requires_dist': metadata.get_all('Requires-Dist', []), 'record_checks': record_checks,
        }
        if check_pypi:
            url = 'https://pypi.org/pypi/' + str(name) + '/' + str(version) + '/json'
            official_url(url)
            with opener.open(Request(url, headers={'User-Agent': 'office-wheelhouse-audit/1'}), timeout=30) as response:
                official_url(response.geturl())
                payload = json.load(response)
            candidates = [f for f in payload['urls'] if f['filename'] == path.name]
            require(len(candidates) == 1, 'official PyPI filename missing/ambiguous')
            artifact = candidates[0]
            official_url(artifact['url'])
            require(urlsplit(artifact['url']).hostname == 'files.pythonhosted.org', 'unexpected artifact host')
            require(artifact['digests']['sha256'] == digest and artifact['size'] == path.stat().st_size,
                    'official PyPI SHA256/size mismatch')
            require(not artifact['yanked'], 'official PyPI artifact is yanked')
            record.update(pypi_metadata_url=url, pypi_artifact_url=artifact['url'],
                          pypi_sha256_verified=True, pypi_yanked=False)
        packages[name] = record
        records.append(record)
    requirements = ROOT / 'deploy/office/requirements.txt'
    roots = []
    for line in requirements.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            dep = Requirement(line)
            require(dep.url is None and not dep.extras and dep.marker is None, 'unexpected direct requirement')
            name = canonicalize_name(dep.name)
            require(name in packages and dep.specifier.contains(packages[name]['version']), 'direct pin not satisfied')
            roots.append(name)
    queue = [(name, '') for name in roots]
    visited = set()
    active = set()
    skipped = set()
    while queue:
        name, extra = queue.pop()
        if (name, extra) in visited:
            continue
        visited.add((name, extra))
        for text in packages[name]['requires_dist']:
            dep = Requirement(text)
            env = dict(TARGET, extra=extra)
            if dep.marker and not dep.marker.evaluate(env):
                skipped.add((name, text))
                continue
            require(dep.url is None, 'direct URL dependency forbidden')
            dependency = canonicalize_name(dep.name)
            require(dependency in packages, 'dependency missing: ' + name + ' -> ' + text)
            require(dep.specifier.contains(packages[dependency]['version']), 'dependency version mismatch: ' + text)
            active.add((name, text, dependency))
            queue.append((dependency, ''))
            queue.extend((dependency, e) for e in dep.extras)
    require({name for name, _ in visited} == set(packages), 'unnecessary wheel outside dependency closure')
    baseline = json.loads((HERE / 'protected-input-hashes.json').read_text())
    for path, expected in baseline.items():
        require(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, 'protected input changed: ' + path)
    report = {
        'schema_version': 1, 'verified_at_utc': datetime.now(timezone.utc).isoformat(),
        'target': TARGET, 'platforms': PLATFORMS, 'architecture_status': 'candidate_only_remote_unverified',
        'glibc_floor': '2.17', 'alpine_musl_supported': False,
        'requirements_sha256': hashlib.sha256(requirements.read_bytes()).hexdigest(),
        'requirements_unchanged': True, 'prior_archives_unchanged': True,
        'pypi_sha256_verified': check_pypi, 'wheel_tags_verified': True, 'dependency_closure_verified': True,
        'wheels_count': len(records), 'total_bytes': sum(r['bytes'] for r in records), 'wheels': records,
        'active_dependencies': [list(e) for e in sorted(active)],
        'skipped_target_or_extra_dependencies': [list(e) for e in sorted(skipped)],
        'packages_installed': False, 'docker_build_verified': False, 'remote_architecture_verified': False,
    }
    suffix = '' if check_pypi else '-offline'
    (HERE / ('audit' + suffix + '.json')).write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    (HERE / 'SHA256SUMS').write_text(''.join(r['sha256'] + '  ' + r['file'] + '\n' for r in records))
    (HERE / 'requirements.lock.txt').write_text(
        '# Candidate Linux/glibc CPython 3.11 x86_64; no application requirements changes.\n' +
        '\n'.join(r['name'] + '==' + r['version'] + ' --hash=sha256:' + r['sha256'] for r in records) + '\n')
    print(json.dumps({k: report[k] for k in ('wheels_count', 'total_bytes', 'wheel_tags_verified',
          'dependency_closure_verified', 'pypi_sha256_verified', 'requirements_unchanged', 'prior_archives_unchanged')}, indent=2))
    for r in records:
        print(r['name'] + '==' + r['version'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pypi', action='store_true', help='check hashes against official PyPI HTTPS metadata')
    try:
        audit(parser.parse_args().pypi)
    except Exception as exc:
        print('WHEELHOUSE AUDIT FAILED: ' + str(exc), file=sys.stderr)
        raise SystemExit(1)
