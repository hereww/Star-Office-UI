# Office v3 independent asset audit

**Result: passed_with_warnings** — 347 passed checks, 0 failures, 2 warnings.

This is an offline technical asset result, **not human approval**. No material/runtime/config/approval was changed.

## Actual targets and read-only configuration

| Direction | Source | Runtime target selected | Face atlases / samples | Body/station exterior max delta |
|---|---|---|---|---|
| down | assets.json | True | 48 face frames / 48 clock samples | 0 pixels |
| up | assets.json | True | 0 face frames / 48 clock samples | 0 pixels |
| left | assets.json | True | 48 face frames / 48 clock samples | 0 pixels |
| right | assets.json | True | 48 face frames / 48 clock samples | 0 pixels |

Base PNGs: 192x192 RGBA. Face atlases: 360x174 / 4x3 / 90x58, 12 source-visible and clipped-actor frames per action. Up has **zero face atlases**, sampled as a static back-facing asset, not cloned expression frames.

Working / idle / syncing / error clocks: 60 / 36 / 60 / 12 at configured 12fps.

Observed 144 actual face frames; 192 fixed-coordinate actor/workstation samples.

## Frozen approved original down: SHA256

Frozen inventory: 19 files; all recorded hashes match: True.
Actual runtime down configuration observed and all five PNGs match: True.

| Asset | Runtime URL | Exact immutable SHA256 match |
|---|---|---|
| base | `../media/character-base.png` | True: `0833992ee3d72a2b55fc8647808f9183761b130a2438d994f7619205c2fbf024` |
| working | `../media/face-working.png` | True: `e81d4eb1f48a2d3ac603b98e222e783373a1867f3add88396d112d3114544e5e` |
| idle | `../media/face-idle-sleep.png` | True: `4c9cdf5553b9bd396353164ada7eed9119f09f272d5d738ca2ff9f869739eb3f` |
| syncing | `../media/face-syncing.png` | True: `3cb52a82dcd558165a53fe44e96738c93828b4652535a8e4832557dac50e2412` |
| error | `../media/face-error-dizzy.png` | True: `91269efdcfa05b00007f59bf4ad89c8636bf34847b06060775dc5fc623eb5ff3` |

## Alpha facts and limitations

| Direction/action | Raw atlas alpha min/max | Cells with genuine transparency | Distinct source / clipped actor |
|---|---|---|---|
| down/working | 240/255 | 0/12 | 12/12 |
| down/idle | 0/255 | 12/12 | 12/12 |
| down/syncing | 0/255 | 6/12 | 12/12 |
| down/error | 0/255 | 12/12 | 12/12 |
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

- left: runtime [96, 16], source manifest [78, 94]. Main integration override retained; do not copy old manifest anchors back into assets.json.

## Failures

- None in the audited static-asset contract.

## Warnings / unverified selection

- **down.working.cell_alpha**: {"genuinelyTransparentCells": "0/12", "perFrameAlphaRanges": [[245, 255], [244, 255], [243, 254], [244, 254], [240, 254], [241, 255], [242, 254], [242, 254], [244, 255], [241, 255], [244, 254], [242, 254]], "note": "Frozen down alpha is preserved, not repaired."}
- **down.syncing.cell_alpha**: {"genuinelyTransparentCells": "6/12", "perFrameAlphaRanges": [[244, 254], [0, 255], [0, 255], [241, 254], [243, 254], [0, 255], [0, 255], [244, 254], [237, 254], [0, 255], [0, 255], [246, 254]], "note": "Frozen down alpha is preserved, not repaired."}

## Read-only and acceptance boundaries

- Static offline asset audit, not browser/runtime/API/UI acceptance; no screenshots or image regeneration.
- It verifies RGBA, dimensions, source alpha statistics, grid/cell content, frozen hashes and deterministic clipped compositions. It cannot prove semantic direction, natural spiral motion, fur aesthetics or sleeping-mouth readability.
- Furniture pixel layers are hash-checked and held fixed. Dynamic screen/LED effects are intentionally not rendered; final monitor/hand/paw occlusion needs integration visual QA.
- The approved down originals are immutable. Any opaque/near-opaque alpha cells are reported as historical frozen-template limitations, not silently relabelled as genuinely transparent or repaired.
- A manifest fallback validates the requested asset pack only. An unselected/missing runtime configuration is reported separately and does not become an integration approval.
- Pixel-centre ellipse clipping and nearest-neighbour offline placement are used. Browser subpixel/ellipse antialiasing and map zoom are outside this pixel audit.
- Only the two report files are written. All humanApproved/visualApproved fields are observed, never modified; a technical pass grants no new human approval.

All 53 observed inputs are hash-checked again at the end of the run; see JSON for before/after SHA256 and per-frame measurements.

## Re-run

```sh
/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 /Users/hepingyu/Documents/ChatGPT/Star-Office-UI/scripts/audit_office_v3_assets.py
```

`--no-write` runs the audit without saving reports; `--self-test` checks pure in-memory positive/negative cases without any file writes.

JSON: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/integration-qa/asset-audit.json`
Markdown: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/integration-qa/asset-audit.md`
