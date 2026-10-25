# 角色动画提示词库（工位与角色分离）
由`make_prompt.py`和`prompts.json`同步拼接；仅输出文字。新工位独立静态绘制，办公角色每套12帧且不含家具。角色和工位组合后仍需视觉验看。换母版用`--reference`，遵循新角色身份，不强制画成橘猫。

## workstation · 静态工位前后两层

类型：static_workstation_layers；1帧，2列×1行；目标单格[192, 192]。

```text
Use case: game-asset. Create a NEW modular static pixel-art office workstation for a top-down 2D cardinal-axis game. The attached orange-cat image is STYLE ONLY; draw NO cat and NO character.

Output one transparent PNG atlas with exactly TWO equal SQUARE cells side by side (2 columns x 1 row), no gaps, no labels, no borders. These are TWO LAYERS OF ONE workstation, NOT alternative designs. Each cell uses the SAME shared coordinates and the same camera. Do not tightly crop objects inside cells. The workstation faces SCREEN DOWN only, toward the bottom of the map. All horizontal desk/keyboard/monitor edges are parallel to the image; legs vertical. A shallow approximately 20-degree look down is acceptable but NEVER isometric, diagonal, 45 degrees, three-quarter rotation or converging perspective.

LEFT CELL: ONLY the rear office chair layer. A compact dark teal padded swivel chair, empty, centered at x=50%. Backrest around x=34..66%, y=16..39%; seat around x=34..66%, y=40..54%; pedestal/wheels below. Leave transparent space around it. No desk, no computer, no keyboard, no person.

RIGHT CELL: ONLY the front desk layer with all computer equipment LOCKED TO THIS DESK. A simple warm light-oak rectangular desk: x=10..90%; desktop rear horizontal edge at y=51%, front edge at y=70%; front modesty panel/legs end at y=92%. The desk is a straight front-facing rectangle with shallow visible top surface, NOT a parallelogram. Leave the entire top 0..43% region transparent to leave room for the future character's head. A complete charcoal LCD MONITOR must be clearly visible, centered at x=50% with upper edge y=45%, bottom of rear casing y=62%, short upright stand and base resting firmly at y=66% on the desk. The monitor SCREEN faces the seated user ABOVE the desk, so its neat BACK faces the camera; this is physically correct, not a missing screen. Stand must be attached and aligned with the monitor and desk, no floating display. A pale keyboard lies flat centered at x=50%, y=54%, on the desk behind the monitor, visible at its sides. Small mouse at x=74%, y=57%, on desk. NO unrelated clutter, plant or paper. Equipment never extends outside the tabletop; keep its geometry coherent.

Style: warm professional chibi pixel-game props, blocky stepped outlines, discrete flat pixel clusters, restrained shadows, dark brown outlines matching the reference's pixel density. No realistic textures, no soft gradients, no smooth vector curves. Both cells retain the same logical margins, scale and exact shared center axis. Real alpha transparency everywhere outside furniture; no checkerboard pixels, no floor, no backdrop, no room.
```

## walk-up · 向上行走（背面）

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN UP only, back view. Show the back of the head and body; do not show front-facing eyes, nose or muzzle. Keep the fixed map camera, not a new camera angle.

Action: walking UP in place, viewed from behind. Alternate left and right steps naturally with gentle opposite arm swings and a small tail sway. The game supplies world translation. Character only: no desk, chair or workstation. No running, jumping or turning.
```

## walk-down · 向下行走（正面）

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

Action: walking DOWN in place, square front view. Preserve the cat face. Alternate left and right steps with gentle opposite arm swings, small body movement and tail sway. The game supplies world translation. Character only: no desk, chair or workstation. No raised fists, running, jumping or turning.
```

## walk-left · 向左行走

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN LEFT only, an exact left-facing profile; nose, chest and toes point left. No partly front-facing or three-quarter body. Keep the fixed map camera.

Action: walking toward SCREEN LEFT in place, full left-facing profile throughout. The tail trails behind toward screen right. Natural alternating steps and gentle opposite arm swings, no front-facing cutaway. Character only: no desk, chair or workstation. No running or turning.
```

## walk-right · 向右行走

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN RIGHT only, an exact right-facing profile; nose, chest and toes point right. No partly front-facing or three-quarter body. Keep the fixed map camera.

Action: walking toward SCREEN RIGHT in place, full right-facing profile throughout. The tail trails behind toward screen left. Natural alternating steps and gentle opposite arm swings. Generate this view from the reference, not a mirrored left-facing sheet. Character only: no desk, chair or workstation. No running or turning.
```

## idle · 待命

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

Action: calm IDLE in the locked requested facing. A subtle breathing cycle, one soft blink when eyes are visible and a small tail or ear movement. Quiet, relaxed and visibly varying across 12 frames. Keep the body square to the selected cardinal axis, not diagonally seated. No walking, typing, waving or sleeping. Character only, intended for the existing rest/standby area rather than a new office workstation.
```

## working · 办公（整理文档/搜索信息/执行任务共用）

类型：character_only；12帧，4列×3行；目标单格[192, 192]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

MODULAR OFFICE CHARACTER ONLY. The workstation is a separately generated STATIC asset, NEVER redrawn in the twelve action cells. Generate a complete upright seated character on true transparent background. Do not draw a desk, chair, keyboard, monitor, mouse, floor, papers or other workstation props. Workstation reference is GEOMETRY ONLY; do not copy its pixels/objects into the actor sheet. Keep the pose/seat anchor, scale, body size and cardinal facing fixed across every cell. The program composes rear chair -> character -> front desk/equipment; it does not repair furniture or register each frame. Hands must be connected to forearms and make small motions in the workstation's fixed keyboard contact zones; a blink-only seated cat is not verified typing.

Down-facing seated actor: exact front view. Use the same square coordinate frame as the referenced desk. Head entirely above the monitor, seat behind the desk, arms reaching into the two visible keyboard zones on its sides. Screen points toward the actor, monitor BACK toward the camera; do not draw any of it in the actor image.

No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station.

If using the current modular-down-v1 coordinate contract, each conceptual cell is 192x192. Intended seat/hips (96,100), head center (96,43), ears near y=13, chin above y=71, head width ~76. Connected paws at the input zones around (49,98) and (144,98), bent legs end around y=135. No object besides the character. Different workstation references take precedence over these example coordinates. Generated coordinates are a request, not a guarantee; use a single character-scale/pose-anchor configuration after extraction and disclose any mismatched hand contact, never per-frame repair.

Action: CHARACTER-ONLY seated typing. Connected arms alternately press small amounts in the reference keyboard zones; blink once in 12 frames. Keep hips/head size fixed and return gently to frame 1. No walking, raised fists or workstation objects. If paws do not reach the contact zones, this is an unaccepted pose candidate, not finished typing.
```

## syncing · 同步备份

类型：character_only；12帧，4列×3行；目标单格[192, 192]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

MODULAR OFFICE CHARACTER ONLY. The workstation is a separately generated STATIC asset, NEVER redrawn in the twelve action cells. Generate a complete upright seated character on true transparent background. Do not draw a desk, chair, keyboard, monitor, mouse, floor, papers or other workstation props. Workstation reference is GEOMETRY ONLY; do not copy its pixels/objects into the actor sheet. Keep the pose/seat anchor, scale, body size and cardinal facing fixed across every cell. The program composes rear chair -> character -> front desk/equipment; it does not repair furniture or register each frame. Hands must be connected to forearms and make small motions in the workstation's fixed keyboard contact zones; a blink-only seated cat is not verified typing.

Down-facing seated actor: exact front view. Use the same square coordinate frame as the referenced desk. Head entirely above the monitor, seat behind the desk, arms reaching into the two visible keyboard zones on its sides. Screen points toward the actor, monitor BACK toward the camera; do not draw any of it in the actor image.

No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station.

If using the current modular-down-v1 coordinate contract, each conceptual cell is 192x192. Intended seat/hips (96,100), head center (96,43), ears near y=13, chin above y=71, head width ~76. Connected paws at the input zones around (49,98) and (144,98), bent legs end around y=135. No object besides the character. Different workstation references take precedence over these example coordinates. Generated coordinates are a request, not a guarantee; use a single character-scale/pose-anchor configuration after extraction and disclose any mismatched hand contact, never per-frame repair.

Action: CHARACTER-ONLY seated backup/sync wait. Hands stay relaxed at the fixed input zones, subtle attentive blink and tiny ear movement. Same seat anchor/scale as working. No device, drive, monitor or furniture; the program supplies the unchanged workstation.
```

## error · 出错提醒

类型：character_only；12帧，4列×3行；目标单格[96, 96]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

Action: a gentle ERROR ALERT reaction, stationary in the locked requested cardinal facing. Concerned facial expression when visible, slightly lowered ears and a small head shake followed by a pause, returning to the first concerned pose. Do not turn the body diagonally. No walking, tears, injuries, raised fists, floating punctuation, alarm icons or smoke. Character only for the existing alert area; do not add a new office workstation.
```

## writing · 整理文档（可选独立动作）

类型：character_only；12帧，4列×3行；目标单格[192, 192]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

MODULAR OFFICE CHARACTER ONLY. The workstation is a separately generated STATIC asset, NEVER redrawn in the twelve action cells. Generate a complete upright seated character on true transparent background. Do not draw a desk, chair, keyboard, monitor, mouse, floor, papers or other workstation props. Workstation reference is GEOMETRY ONLY; do not copy its pixels/objects into the actor sheet. Keep the pose/seat anchor, scale, body size and cardinal facing fixed across every cell. The program composes rear chair -> character -> front desk/equipment; it does not repair furniture or register each frame. Hands must be connected to forearms and make small motions in the workstation's fixed keyboard contact zones; a blink-only seated cat is not verified typing.

Down-facing seated actor: exact front view. Use the same square coordinate frame as the referenced desk. Head entirely above the monitor, seat behind the desk, arms reaching into the two visible keyboard zones on its sides. Screen points toward the actor, monitor BACK toward the camera; do not draw any of it in the actor image.

No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station.

If using the current modular-down-v1 coordinate contract, each conceptual cell is 192x192. Intended seat/hips (96,100), head center (96,43), ears near y=13, chin above y=71, head width ~76. Connected paws at the input zones around (49,98) and (144,98), bent legs end around y=135. No object besides the character. Different workstation references take precedence over these example coordinates. Generated coordinates are a request, not a guarantee; use a single character-scale/pose-anchor configuration after extraction and disclose any mismatched hand contact, never per-frame repair.

Action: CHARACTER-ONLY seated document-writing motion, small connected paw movements in the fixed document contact zone of the reference workstation. No notebook, desk, paper or pencil drawn in the actor image; any required stationery must be a separate static prop. Keep seat anchor and face direction fixed.
```

## researching · 搜索信息（可选独立动作）

类型：character_only；12帧，4列×3行；目标单格[192, 192]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

MODULAR OFFICE CHARACTER ONLY. The workstation is a separately generated STATIC asset, NEVER redrawn in the twelve action cells. Generate a complete upright seated character on true transparent background. Do not draw a desk, chair, keyboard, monitor, mouse, floor, papers or other workstation props. Workstation reference is GEOMETRY ONLY; do not copy its pixels/objects into the actor sheet. Keep the pose/seat anchor, scale, body size and cardinal facing fixed across every cell. The program composes rear chair -> character -> front desk/equipment; it does not repair furniture or register each frame. Hands must be connected to forearms and make small motions in the workstation's fixed keyboard contact zones; a blink-only seated cat is not verified typing.

Down-facing seated actor: exact front view. Use the same square coordinate frame as the referenced desk. Head entirely above the monitor, seat behind the desk, arms reaching into the two visible keyboard zones on its sides. Screen points toward the actor, monitor BACK toward the camera; do not draw any of it in the actor image.

No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station.

If using the current modular-down-v1 coordinate contract, each conceptual cell is 192x192. Intended seat/hips (96,100), head center (96,43), ears near y=13, chin above y=71, head width ~76. Connected paws at the input zones around (49,98) and (144,98), bent legs end around y=135. No object besides the character. Different workstation references take precedence over these example coordinates. Generated coordinates are a request, not a guarantee; use a single character-scale/pose-anchor configuration after extraction and disclose any mismatched hand contact, never per-frame repair.

Action: CHARACTER-ONLY seated searching. Connected paws make small keypresses in the fixed workstation input zones, pause thoughtfully, then resume with a focused blink. No desk, monitor, keyboard, paper or detached prop in the actor sheet.
```

## executing · 执行任务（可选独立动作）

类型：character_only；12帧，4列×3行；目标单格[192, 192]。

```text
Create exactly 12 DISTINCT chronological frames of ONE looping pixel-RPG character action using the FIRST attached character reference as the exact identity source. Arrange them in exactly 4 columns by 3 rows, read left-to-right then top-to-bottom. One full loop for playback at 12 fps. Keep the same character proportions, fur colors and markings, rendering style and scale across all cells. Preserve the reference character's species, markings, colors, face, connected limbs and tail (when present); do not turn a replacement character into the default orange cat. Use the map's fixed orthogonal pixel-game projection, with facing restricted to screen UP, DOWN, LEFT or RIGHT. Lock the requested facing in every frame; no diagonal facing, 45-degree pose, three-quarter view, isometric arrangement or camera rotation. Use equal square cells, without gutters between cells. Preserve consistent full-cell placement; never tightly crop or recenter individual frames. Keep all ears, paws, tails  inside the cell. Genuine alpha transparency; no checkerboard picture, full office background, floor, shadows, labels, frame numbers, readable text, speech bubbles or detached decorative effects. Natural modest motion from frame 01 through 12 back to 01, not repeated still pictures. Only ONE action and ONE facing per sheet. Walking/standby/error target cells are 96x96; modular office character cells are 192x192 in the workstation coordinate system. Larger generation resolution is acceptable.

The orange tabby has pink ears, brown eyes where visible, three dark forehead stripes, a cream muzzle and belly, orange paws without white socks, and a consistently attached striped curled tail.

Facing: SCREEN DOWN only, straight front view toward the bottom of the map. Head, shoulders and body are square to the image, not tilted or turned diagonally. Keep the fixed map camera.

MODULAR OFFICE CHARACTER ONLY. The workstation is a separately generated STATIC asset, NEVER redrawn in the twelve action cells. Generate a complete upright seated character on true transparent background. Do not draw a desk, chair, keyboard, monitor, mouse, floor, papers or other workstation props. Workstation reference is GEOMETRY ONLY; do not copy its pixels/objects into the actor sheet. Keep the pose/seat anchor, scale, body size and cardinal facing fixed across every cell. The program composes rear chair -> character -> front desk/equipment; it does not repair furniture or register each frame. Hands must be connected to forearms and make small motions in the workstation's fixed keyboard contact zones; a blink-only seated cat is not verified typing.

Down-facing seated actor: exact front view. Use the same square coordinate frame as the referenced desk. Head entirely above the monitor, seat behind the desk, arms reaching into the two visible keyboard zones on its sides. Screen points toward the actor, monitor BACK toward the camera; do not draw any of it in the actor image.

No workstation geometry reference is attached. Generate only a seated character pose concept, never furniture. Hand contact/alignment cannot be verified without the actual station.

If using the current modular-down-v1 coordinate contract, each conceptual cell is 192x192. Intended seat/hips (96,100), head center (96,43), ears near y=13, chin above y=71, head width ~76. Connected paws at the input zones around (49,98) and (144,98), bent legs end around y=135. No object besides the character. Different workstation references take precedence over these example coordinates. Generated coordinates are a request, not a guarantee; use a single character-scale/pose-anchor configuration after extraction and disclose any mismatched hand contact, never per-frame repair.

Action: CHARACTER-ONLY seated task execution, not running. Connected paws tap the fixed keyboard input zones deliberately, pause to watch the separately rendered monitor, make a tiny confident nod. No leg-running, speed lines, progress text or furniture.
```
