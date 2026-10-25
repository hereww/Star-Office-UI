import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {RUNTIME_READY_CHARACTER_PROFILE_IDS} from '../frontend/company-office/character-profile-runtime.mjs';

const root = new URL('../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const source = name => readFileSync(new URL(name, root), 'utf8');
const contract = read('frontend/company-office/connected-v5/character-template.json');
const reference = read('frontend/company-office/reference-v3/assets.json');
const assets = read('frontend/company-office/connected-v5/assets.json');
const layout = read('frontend/company-office/connected-v5/layout.json');
const catalog = read('frontend/company-office/character-catalog.json');
const python = code => JSON.parse(execFileSync('python3', ['-c', code], {cwd: fileURLToPath(root), encoding: 'utf8'}));

test('template identifies the current V5 scene and separate screen-effects player', () => {
  assert.equal(contract.schemaVersion, 5);
  assert.equal(contract.templateId, 'connected-v5-character-template-v1');
  assert.equal(contract.scene, layout.id);
  assert.equal(contract.animationMode, assets.animationMode);
  assert.equal(contract.furnitureMode, layout.furnitureMode);
  assert.equal(contract.playerModule, './seated-player.mjs');
  assert.equal(contract.runtimeModule, './runtime.mjs');
  assert.equal(assets.characterTemplate, './character-template.json');
});

test('V5 template preserves four independent poses, rear-view privacy, and full-frame clocks', () => {
  assert.deepEqual(contract.directions, ['up', 'down', 'left', 'right']);
  assert.deepEqual(contract.businessStateToAction, reference.businessStateToAction);
  assert.deepEqual(contract.grid, [4, 3]);
  assert.equal(contract.frameCount, 12);
  assert.equal(contract.fps, 12);
  assert.deepEqual(contract.faceClockFrames, {working: 60, idle: 36, syncing: 60, error: 12});
  assert.deepEqual(contract.faceClockFrames, assets.faceClockFrames);
  for (const direction of contract.directions) {
    const baseline = contract.baselineGeometry[direction];
    const spec = reference.directions[direction];
    for (const key of ['frameSize', 'poseAnchor', 'headAnchor', 'scale', 'faceVisible']) assert.deepEqual(baseline[key], spec.character[key]);
    assert.deepEqual(baseline.seatAnchor, spec.furniture.seatAnchor);
    if (direction === 'up') {
      assert.equal(baseline.faceVisible, false);
      assert.equal(baseline.animationMode, 'full-frame');
    } else {
      assert.equal(baseline.animationMode, 'full-frame');
      for (const key of ['faceRect','faceClipEllipse','faceFrameSize','referenceFaces']) assert.equal(key in baseline, false);
    }
  }
});

test('all sixteen V5 seats reuse the approved two benches with no generated desk or hands', () => {
  assert.equal(contract.sharedWorkstation.benchCount, 2);
  assert.equal(contract.sharedWorkstation.seatCount, 16);
  assert.equal(contract.sharedWorkstation.replaceWithCharacter, false);
  assert.deepEqual(contract.sharedWorkstation.benches, layout.benches.map(({id, orientation, manifest, stationIds}) => ({id, orientation, manifest, stationIds})));
  assert.deepEqual(contract.screenAnimationContract, assets.screenAnimationContract);
  assert.equal(contract.screenAnimationContract.mode, 'screen-only');
  assert.equal(contract.screenAnimationContract.rearScreens, 'led-only');
  for (const feature of ['walking', 'keyboardInteraction', 'handsAnimation']) assert.equal(contract.freeze[feature], false);
  for (const feature of ['body', 'headOutline', 'ears', 'tail', 'poseAnchor', 'furniture']) assert.equal(contract.freeze[feature], true);
});

test('backend, frontend, and V5 readiness IDs agree for all validated profiles', () => {
  const backend = python('import json; from backend.office_characters import CHARACTER_TEMPLATE_ID, public_character_profiles; print(json.dumps({"templateId":CHARACTER_TEMPLATE_ID,"profiles":public_character_profiles()}))');
  assert.equal(backend.templateId, contract.templateId);
  assert.equal(catalog.templateId, contract.templateId);
  assert.equal(catalog.runtimeScene, contract.scene);
  assert.equal(catalog.animationMode, contract.animationMode);
  assert.deepEqual(backend.profiles.map(p => p.id), catalog.profiles.map(p => p.id));
  assert.deepEqual(RUNTIME_READY_CHARACTER_PROFILE_IDS, contract.readiness.productionProfileIds);
  assert.deepEqual(catalog.profiles.filter(p => p.assignable).map(p => p.id), catalog.profiles.map(p => p.id));
  assert.deepEqual(backend.profiles.filter(p => p.assignable).map(p => p.id), catalog.profiles.map(p => p.id));
  for (const profile of catalog.profiles) {
    const other = backend.profiles.find(p => p.id === profile.id);
    assert.equal(profile.templateId, contract.templateId);
    assert.equal(other.template_id, contract.templateId);
    assert.equal(profile.status, other.status);
    assert.equal(profile.assignable, other.assignable);
    assert.equal(profile.productionReady, other.production_ready);
  }
  assert.equal(contract.readiness.candidateProfileIds.length, 0);
  for (const profile of catalog.profiles.filter(p => p.id !== 'orange-cat-v1')) {
    assert.equal(profile.status, 'ready');
    assert.equal(profile.productionReady, true);
    assert.equal(profile.assignable, true);
    assert.equal(profile.staticConcept.transparentBackground, true);
    assert.equal(profile.staticConcept.direction, 'down');
  }
});

test('admin preview selects the V5 chair-only player, not the old full-workstation renderer', () => {
  const admin = source('frontend/office/admin.mjs');
  assert.ok(admin.includes("../company-office/connected-v5/seated-player.mjs"));
  assert.ok(admin.includes('new ConnectedSeatedPlayer(canvas, assets'));
  assert.ok(admin.includes('v5-character-template-link'));
  assert.equal(admin.includes('new DirectionalSeatedPlayer'), false);
  assert.equal(admin.includes('reference-v3/directional-player.mjs'), false);
  assert.ok(admin.includes('demoCharacterProfileId = demoProfileSelect.value; updateDemoProfileUI'));
  assert.ok(admin.includes("静态概念图已完成 · 四向与状态动画待制作"));
});

test('immutable package dependency closure contains V5 contract, individual static concepts and actual player', () => {
  const paths = python('import json; from pathlib import Path; from scripts.package_office_release import collect_frontend; root=Path.cwd(); print(json.dumps([p.relative_to(root).as_posix() for p in collect_frontend(root)]))');
  for (const file of ['frontend/company-office/connected-v5/character-template.json', 'frontend/company-office/connected-v5/seated-player.mjs', 'frontend/company-office/connected-v5/runtime.mjs', ...catalog.profiles.filter(p => p.id !== 'orange-cat-v1').flatMap(p => [`frontend/office/media/character-breed-candidates/${p.id}.png`, `frontend/company-office/media/character-breeds/${p.id}/manifest.json`]), 'frontend/company-office/character-profile-assets.mjs']) assert.ok(paths.includes(file), file);
  assert.equal(paths.some(path => path.startsWith('assets/')), false);
  assert.equal(paths.some(path => path.includes('/.local/')), false);
});
