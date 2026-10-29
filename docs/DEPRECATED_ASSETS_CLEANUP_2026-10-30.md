# Deprecated asset cleanup — 2026-10-30

This cleanup follows the current production boundary: `frontend/office` with the V5 connected-office runtime and the V4 telemetry adapter.

The following obsolete V5 material was removed from the repository tree:

- 31 face-only atlases under `frontend/company-office/media/character-breeds/**`. Current profiles use complete 4×3 full-frame atlases; no runtime manifest or release dependency loads these files.
- `frontend/company-office/pixel-face-animation.mjs`, which is not imported by the current runtime and is rejected by the full-frame contract.
- `frontend/company-office/connected-v4/style.css` and `frontend/company-office/connected-v5/style.css`, unused CSS shims.
- `frontend/office/media/character-breed-candidate-board.png`, unused candidate-board art.
- `frontend/company-office/media/character-breeds/orange-cat-v1/manifest.json`, unused by the default profile path.

The 31 face atlases remain locally in the ignored, categorized directory:

```text
archive/legacy-face-atlases/<profile-id>/<direction>/face-*.png
```

They are preserved for rollback/reference and excluded from GitHub by `.gitignore`.

The GitHub `master` branch already contains the earlier removal of the large `deploy/office/out/` and `deploy/bundles/` payloads. This cleanup adds an explicit ignore rule for future `deploy/office/out/` output and preserves the small release index/checksum files that belong in the repository. Existing legacy root/Electron/V3 compatibility code and current V4/V5 runtime files remain.

The V4/V5/reference module imports retain the deployed `?v=20261026-02` module identity fix so the cleanup does not reintroduce the map initialization failure.

Validation after cleanup:

- `python3 scripts/test_office_release.py` — 60/60
- `node scripts/test_office_connected_v4_contract.mjs` — 12/12
- `node scripts/test_office_v5_character_template.mjs` — 6/6
- V5 rock-room contract — passed
- No production data, server files, or compatibility runtime directories were changed by this repository cleanup.
