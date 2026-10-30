# Office v3 independent asset audit

**Result: failed** — 251 passed checks, 2 failures, 3 warnings.

This is an offline technical asset result, **not human approval**. No material/runtime/config/approval was changed.

## Actual targets and read-only configuration

| Direction | Source | Runtime target selected | Face atlases / samples | Body/station exterior max delta |
|---|---|---|---|---|
| down | unavailable | True | ERROR | KeyError: 'face' |
| up | manifest_fallback | False | 0 face frames / 48 clock samples | 0 pixels |
| left | manifest_fallback | False | 48 face frames / 48 clock samples | 0 pixels |
| right | manifest_fallback | False | 48 face frames / 48 clock samples | 0 pixels |

Base PNGs: 192x192 RGBA. Face atlases: 360x174 / 4x3 / 90x58, 12 source-visible and clipped-actor frames per action. Up has **zero face atlases**, sampled as a static back-facing asset, not cloned expression frames.

Working / idle / syncing / error clocks: 60 / 36 / 60 / 12 at configured 12fps.

Observed 96 actual face frames; 144 fixed-coordinate actor/workstation samples.

## Frozen approved original down: SHA256

Frozen inventory: 19 files; all recorded hashes match: True.
Actual runtime down configuration observed and all five PNGs match: False.

| Asset | Runtime URL | Exact immutable SHA256 match |
|---|---|---|

## Alpha facts and limitations

| Direction/action | Raw atlas alpha min/max | Cells with genuine transparency | Distinct source / clipped actor |
|---|---|---|---|
| left/working | 0/254 | 12/12 | 12/12 |
| left/idle | 0/254 | 12/12 | 12/12 |
| left/syncing | 0/254 | 12/12 | 12/12 |
| left/error | 0/254 | 12/12 | 12/12 |
| right/working | 0/254 | 12/12 | 12/12 |
| right/idle | 0/254 | 12/12 | 12/12 |
| right/syncing | 0/254 | 12/12 | 12/12 |
| right/error | 0/254 | 12/12 | 12/12 |

**An RGBA mode is not proof of transparent background.** Genuine source alpha is min=0 with visible artwork >=128; partial-alpha maximum 254 is valid and is not forced to 255.
Frozen down working/syncing alpha limitations are disclosed below and their immutable bytes are verified. The runtime clips face overlays to the configured ellipse; this audit checks stable exterior body pixels, not an invented transparent re-export.

## Static body and furniture

Each action was composed with the exact fixed faceRect and pixel-centre ellipse, without per-frame alignment/rotation. Body pixels outside rect/ellipse were compared with the base, each action first frame, and the first state frame. Workstation pixels outside the placed face were compared likewise.
Furniture back/front/full PNGs are checked against manifest SHA256; complementary layers reconstruct the full normalized asset; layer bytes remain fixed through all state samples. Screens/LED dynamics are excluded.

## Integration headAnchor observations (no mutation)


## Failures

- **runtime.global.animationMode**: "full-frame"
- **down.audit_exception**: "KeyError: 'face'"

## Warnings / unverified selection

- **runtime.up.target_selected**: {"target": "media/character-up/manifest.json", "selectedInAssetsJson": false, "runtimeBindings": {"base": "../media/character-breeds/orange-cat-v1/up/base.png", "actions": {"working": null, "idle": null, "syncing": null, "error": null}}, "manifestBindings": {"base": "media/character-up/base.png", "actions": {"working": null, "idle": null, "syncing": null, "error": null}}, "configSource": "manifest_fallback"}
- **runtime.left.target_selected**: {"target": "media/character-left/repair-v2/manifest.json", "selectedInAssetsJson": false, "runtimeBindings": {"base": "../media/character-breeds/orange-cat-v1/left/base.png", "actions": {"working": null, "idle": null, "syncing": null, "error": null}}, "manifestBindings": {"base": "media/character-left/repair-v2/character-base.png", "actions": {"working": "media/character-left/repair-v2/face-working.png", "idle": "media/character-left/repair-v2/face-idle.png", "syncing": "media/character-left/repair-v2/face-syncing.png", "error": "media/character-left/repair-v2/face-error.png"}}, "configSource": "manifest_fallback"}
- **runtime.right.target_selected**: {"target": "media/character-right/repair-v4-aligned/manifest.json", "selectedInAssetsJson": false, "runtimeBindings": {"base": "../media/character-breeds/orange-cat-v1/right/base.png", "actions": {"working": null, "idle": null, "syncing": null, "error": null}}, "manifestBindings": {"base": "media/character-right/repair-v4-aligned/base.png", "actions": {"working": "media/character-right/repair-v4-aligned/face-working.png", "idle": "media/character-right/repair-v4-aligned/face-idle.png", "syncing": "media/character-right/repair-v4-aligned/face-syncing.png", "error": "media/character-right/repair-v4-aligned/face-error.png"}}, "configSource": "manifest_fallback"}

## Read-only and acceptance boundaries

- Static offline asset audit, not browser/runtime/API/UI acceptance; no screenshots or image regeneration.
- It verifies RGBA, dimensions, source alpha statistics, grid/cell content, frozen hashes and deterministic clipped compositions. It cannot prove semantic direction, natural spiral motion, fur aesthetics or sleeping-mouth readability.
- Furniture pixel layers are hash-checked and held fixed. Dynamic screen/LED effects are intentionally not rendered; final monitor/hand/paw occlusion needs integration visual QA.
- The approved down originals are immutable. Any opaque/near-opaque alpha cells are reported as historical frozen-template limitations, not silently relabelled as genuinely transparent or repaired.
- A manifest fallback validates the requested asset pack only. An unselected/missing runtime configuration is reported separately and does not become an integration approval.
- Pixel-centre ellipse clipping and nearest-neighbour offline placement are used. Browser subpixel/ellipse antialiasing and map zoom are outside this pixel audit.
- Only the two report files are written. All humanApproved/visualApproved fields are observed, never modified; a technical pass grants no new human approval.

All 45 observed inputs are hash-checked again at the end of the run; see JSON for before/after SHA256 and per-frame measurements.

## Re-run

```sh
/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/.local/office-production-20261004/venv/bin/python /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/scripts/audit_office_v3_assets.py
```

`--no-write` runs the audit without saving reports; `--self-test` checks pure in-memory positive/negative cases without any file writes.

JSON: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/integration-qa/asset-audit.json`
Markdown: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/integration-qa/asset-audit.md`
