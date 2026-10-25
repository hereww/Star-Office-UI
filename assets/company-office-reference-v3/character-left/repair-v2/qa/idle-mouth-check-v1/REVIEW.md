# Left repair-v2 idle mouth QA

## Result

**Technical pass; no PNG or alpha-mask repair required. `humanApproved: false`, `visualApproved: false`.**

The raw image_gen idle source contains a black open sleeping mouth and pink tongue. Its whole-sheet nearest-neighbour normalized source exactly matches the preserved `sources/face-idle.png`. All 12 frames retain the source oral-cavity dark pixels, tongue pink pixels, and closed-eyelid pixels. Removed dark pixels belong to the duplicate source jaw perimeter, not to the mouth. The small brown antialias pixels near the external jaw in frames 10/11 are not tongue.

Every expression PNG, neutral base, original candidate, source image and existing QA contact was preserved byte-for-byte. Only the two repair-v2 manifests gained `humanApproved: false`, `readyForLocalPreview: true`, and a focused QA reference. Their exact prior bytes are saved in this directory. The character config, action paths, face placement, clocks and headAnchor in those manifests are unchanged.

## Fixed configuration (unchanged)

- Canvas: 192x192; face atlas: 360x174, 4x3, 90x58 per cell; 12 distinct frames each action.
- `faceRect: [38,64,90,58]`; `faceClipEllipse: [76,93,32,27]`.
- `poseAnchor: [96,174]`; scale 0.6; working/idle/syncing/error clocks 60/36/60/12.
- Asset manifest `headAnchor: [78,94]` was deliberately not edited. Main's current integration config was read-only observed as `[96, 16]`. Do not overwrite main's corrected integration anchor with the older asset metadata.

## Actual mouth retention

Cavity boxes are half-open logical-cell coordinates. Dark-mouth extraction uses a wider independent oral source ROI and source-alpha perimeter exclusion, not the final build expression mask. Tongue is checked independently by pink colour. All retained visible RGB and alpha equal their original normalized generated pixels.

| Frame | Source cavity dark | Retained | Missing | Source tongue pink | Missing tongue | Cavity WxH |
|---|---:|---:|---:|---:|---:|---|
| 00 | 64 | 64 | 0 | 8 | 0 | 9x11 |
| 01 | 70 | 70 | 0 | 9 | 0 | 10x11 |
| 02 | 87 | 87 | 0 | 15 | 0 | 11x12 |
| 03 | 94 | 94 | 0 | 18 | 0 | 12x13 |
| 04 | 165 | 165 | 0 | 36 | 0 | 16x17 |
| 05 | 220 | 220 | 0 | 57 | 0 | 19x18 |
| 06 | 262 | 262 | 0 | 47 | 0 | 21x19 |
| 07 | 195 | 195 | 0 | 48 | 0 | 18x18 |
| 08 | 149 | 149 | 0 | 35 | 0 | 16x15 |
| 09 | 127 | 127 | 0 | 21 | 0 | 14x14 |
| 10 | 93 | 93 | 0 | 14 | 0 | 11x13 |
| 11 | 77 | 77 | 0 | 6 | 0 | 10x12 |

- Missing closed-eyelid source pixels: 0 in every frame.
- Dark oral component count: 1 in every final idle frame.
- Neutral base old mouth inner residual: 0; `noDoubleMouth: true`.
- 12 unique visible face frames and 12 unique composed frames in all four actions.
- Across all 48 compositions: faceRect exterior 0 changes, ellipse exterior 0 changes, original head/body outer contour RGBA 0 changes, alpha support/silhouette 0 changes, visible source RGB/alpha 0 changes.
- Neutral base original alpha remains byte-exact. Source-over compositing can increase partial alpha **inside** the face (up to 621 affected inner pixels); this is expected composition, not outline or body movement.
- True PNG transparency checked: atlas alpha min=0, max>=128. A generated partial-alpha feature need not include a fully opaque 255 pixel.
- Existing spiral QA APNG has 12 frames and is unchanged. No equal-angle mathematical gate was added.
- 133 previous protected inputs, including original candidates/approved assets: unchanged.
- 239 of 241 existing scoped files unchanged; the only 2 differences are intended manifest metadata additions.

## Readability risk, not mask loss

Source F00 has a smaller **open** mouth, 9x11 logical pixels. At scale .6 that becomes approximately 5.4x6.6 before any further overview zoom. Read-only inspection of the existing player confirms tick 0 and ticks 12..35 select F00: 25 of 36 idle ticks. Frames 5/6 show a much larger open cavity (19x18 / 21x19). This explains why a first-frame-only or zoomed-out workstation contact can look less clearly asleep. It does not justify adding, enlarging, moving, redrawing, or reordering generated features without a separate request.

No UI/runtime/furniture changes. Static paw shapes remain preserved; the read-only workstation composite shows no typing hands and furniture hides lower feet. This focused offline check is not a live runtime/hand-loader test. Main retains final workstation occlusion and human visual acceptance.

## Evidence

- Full measurements: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/qa/idle-mouth-check-v1/validation.json`
- Source / final alpha / feature overlay / fixed-base face F00/F05/F06/F11: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/qa/idle-mouth-check-v1/idle-source-alpha-composite-contact.png`
- All 12 source / masked / composed mouths: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/qa/idle-mouth-check-v1/idle-all-12-mouth-source-mask-composite.png`
- All 12 idle workstation phases: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/qa/idle-mouth-check-v1/idle-all-12-workstation-contact-2x.png`
- Four-action fixed-body contact: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/qa/idle-mouth-check-v1/four-action-composite-contact.png`
- Reproducible offline QA script: `/Users/hepingyu/Documents/ChatGPT/Star-Office-UI/assets/company-office-reference-v3/character-left/repair-v2/scripts/qa_idle_mouth_retention.py`

The initial QA diagnostic and script are also preserved. That first tester incorrectly compared every composed alpha byte, required alpha maximum 255, and included a lower eyelid segment in its oral ROI. The tester definitions were corrected to check silhouette/support, preserve genuine partial-alpha, and count oral y>=28 only. No character art was changed to force those checks to pass.
