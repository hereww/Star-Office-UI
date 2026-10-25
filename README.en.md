# Star Office UI 6.0.0

![Star Office UI 6.0.0](assets/company-office-connected-v5/qa/desktop-4k-overview.png)

Star Office UI is an independently maintained real-time AI collaboration office and status observability platform. Version 6.0.0 is a full-stack rewrite with a 16-seat pixel office, Flask services, optional desktop shells, Sub2API telemetry integration, and reproducible offline release tooling.

This repository is the complete `hereww/Star-Office-UI` project. Its descriptions, source layout, screenshots, and deployment docs describe the current codebase.

## What is included

- A 16-seat office map with four-direction characters, seated states, screen effects, status bubbles, and mobile layouts.
- Flask employee/admin endpoints, configuration APIs, snapshots, and versioned static resources.
- A read-only collector that projects Sub2API user telemetry into office snapshots.
- `integrations/sub2api/` with the host source, user telemetry plugin, plugin UI, migrations, patches, and `.s2plugin` packaging/signing tools.
- Optional Electron and Tauri shells that reuse the same Python backend.
- Offline release packaging, Docker Compose, Nginx/TLS, backup, and rollback tools under `deploy/office/`.

## Quick start

Python 3.10+ is required:

```bash
git clone https://github.com/hereww/Star-Office-UI.git
cd Star-Office-UI
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp state.sample.json state.json
python backend/app.py
```

Open `http://127.0.0.1:19000/`. For the rewritten office mode, enable it explicitly with the variables documented in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Verification

```bash
python -m compileall -q backend scripts
python scripts/test_office_release.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s integrations/sub2api/plugin-tools/tests -v
cd integrations/sub2api/host-source/backend
go test ./cmd/user-telemetry-plugin/...
```

## Documentation

- [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md) — architecture and source boundaries.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — development, offline release, Docker, TLS, backup, and rollback.
- [`integrations/sub2api/README.md`](./integrations/sub2api/README.md) — Sub2API host, plugin, and packaging source.
- [`deploy/office/README.md`](./deploy/office/README.md) — production office release constraints.

Generated release archives, dependency caches, runtime data, OAuth credentials, tokens, password hashes, private keys, and databases are intentionally excluded from the source repository. OAuth values in the bundled Sub2API source are `REDACTED_*` placeholders and must be injected through controlled deployment configuration.

The root project follows [`LICENSE`](./LICENSE). The bundled Sub2API source retains and follows its upstream license.
