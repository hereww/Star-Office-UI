#!/usr/bin/env node
/** Loopback-only browser acceptance for direct admin display saves. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const adminUrl = process.env.OFFICE_QA_ADMIN_URL || 'https://127.0.0.1:19444/admin';
const password = process.env.OFFICE_QA_ADMIN_PASSWORD;
const parsedAdminUrl = new URL(adminUrl);
assert.equal(parsedAdminUrl.hostname, '127.0.0.1', 'direct-save QA must stay loopback-only');
assert.equal(parsedAdminUrl.protocol, 'https:', 'admin QA must use HTTPS');
assert.ok(password, 'pass a synthetic fixture password through OFFICE_QA_ADMIN_PASSWORD');

const require = createRequire(process.env.OFFICE_QA_NODE_PACKAGE || '/Users/hepingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium} = require('playwright');
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--ignore-certificate-errors']});
const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

async function api(path) {
  return page.evaluate(async path => {
    const response = await fetch(path, {cache: 'no-store', credentials: 'same-origin'});
    return {status: response.status, data: await response.json()};
  }, path);
}

async function saveRoom(enabled) {
  await page.getByTestId('nav-display').click();
  const control = page.getByTestId('rock-room-characters-enabled');
  await control.setChecked(enabled);
  assert.equal(await page.getByTestId('config-save').isDisabled(), false, 'display settings must save without preview');
  assert.match(await page.getByTestId('config-save-state').innerText(), /可直接保存/);
  await page.getByTestId('config-save').click();
  await page.getByTestId('dialog-confirm').click();
  await page.getByTestId('admin-notice').getByText('已读回确认').waitFor({timeout: 10000});
  return (await api('/api/office/admin/config')).data.config;
}

try {
  await page.goto(adminUrl, {waitUntil: 'networkidle', timeout: 30000});
  await page.getByTestId('admin-password').fill(password);
  await page.getByTestId('admin-login').click();
  await page.getByTestId('nav-overview').waitFor({timeout: 10000});

  const initial = (await api('/api/office/admin/config')).data.config;
  const originalEnabled = initial.room_characters.rock.enabled;
  const changed = await saveRoom(!originalEnabled);
  assert.equal(changed.room_characters.rock.enabled, !originalEnabled);
  const restored = await saveRoom(originalEnabled);
  assert.equal(restored.room_characters.rock.enabled, originalEnabled);
  assert.deepEqual(pageErrors, []);

  const evidenceDir = process.env.OFFICE_QA_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(resolve(evidenceDir), {recursive: true});
    await page.screenshot({path: resolve(evidenceDir, 'admin-display-direct-save.png'), fullPage: true});
  }
  console.log(JSON.stringify({
    status: 'passed',
    initialVersion: initial.version,
    changedVersion: changed.version,
    restoredVersion: restored.version,
    originalEnabled,
    changedEnabled: changed.room_characters.rock.enabled,
    pageErrors,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
