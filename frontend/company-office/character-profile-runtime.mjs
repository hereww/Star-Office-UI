/**
 * Runtime readiness gate for character profiles.
 *
 * The backend catalog may list prompt-ready candidates, but the employee
 * renderer must only accept profiles whose complete asset manifest and visual
 * QA have been wired into the current runtime. Keep this list deliberately
 * small until a new profile has an atomic preload/replace implementation.
 */
export const DEFAULT_CHARACTER_PROFILE_ID = 'orange-cat-v1';
export const RUNTIME_READY_CHARACTER_PROFILE_IDS = Object.freeze(['orange-cat-v1','ragdoll-v1','british-shorthair-v1','american-shorthair-v1','tabby-v1','tuxedo-cat-v1','white-lion-cat-v1','jianzhou-cat-v1']);

const CHARACTER_BASE_URL = new URL('./media/character-breeds/', import.meta.url);
const DEFAULT_CHARACTER_PORTRAIT_URL = new URL('./media/character-base.png', import.meta.url).href;

export function runtimeCharacterProfileId(value) {
  return typeof value === 'string' && RUNTIME_READY_CHARACTER_PROFILE_IDS.includes(value)
    ? value
    : DEFAULT_CHARACTER_PROFILE_ID;
}

export function isRuntimeReadyCharacterProfile(value) {
  return runtimeCharacterProfileId(value) === value;
}

/**
 * Resolve the fixed local portrait used by the fullscreen roster.
 *
 * Profile IDs are first reduced through the runtime allowlist so a telemetry
 * value can never turn into an arbitrary asset URL.  The default portrait
 * keeps the existing approved orange-cat asset; every other ready profile
 * uses its own complete down-facing 192px base frame.
 */
export function characterPortraitUrl(value) {
  const profileId = runtimeCharacterProfileId(value);
  if (profileId === DEFAULT_CHARACTER_PROFILE_ID) return DEFAULT_CHARACTER_PORTRAIT_URL;
  return new URL(`${profileId}/down/base.png`, CHARACTER_BASE_URL).href;
}
