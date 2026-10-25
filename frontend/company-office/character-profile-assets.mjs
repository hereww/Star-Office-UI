import { DEFAULT_CHARACTER_PROFILE_ID, isRuntimeReadyCharacterProfile } from './character-profile-runtime.mjs';
import { validateDirectionalAssets } from './reference-v3/directional-player.mjs';

// The explicit index is part of the packaged dependency closure. A configuration
// can select an ID, never a URL or an arbitrary sprite manifest.
export const CHARACTER_PROFILE_INDEX_URL = new URL('./character-profile-assets.json', import.meta.url).href;
const cachedIndexes = new WeakMap();
function cachedJson(fetcher, url) {
  let cache = cachedIndexes.get(fetcher);
  if (!cache) { cache = new Map(); cachedIndexes.set(fetcher, cache); }
  if (!cache.has(url)) {
    const pending = (async () => {
      const response = await fetcher(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`角色资源加载失败 (${response.status})`);
      return response.json();
    })();
    cache.set(url, pending); pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
  }
  return cache.get(url);
}
function localAsset(value,base){
  if(typeof value!=='string'||!value.startsWith('./')||value.includes('..'))throw new Error('角色资源路径无效');
  const url=new URL(value,base);if(url.origin!==new URL(base).origin)throw new Error('角色资源必须同源');return url.href;
}
export function mergeCharacterProfileAssets(referenceAssets, manifest, manifestUrl, profileId) {
  if (manifest?.profileId !== profileId || manifest.schemaVersion !== 2 || manifest.manifestContractVersion !== 2 || manifest.animationMode !== 'full-frame' ||
      manifest.frameCount !== 12 || manifest.fps !== 12 ||
      manifest.grid?.[0] !== 4 || manifest.grid?.[1] !== 3 ||
      Object.keys(manifest.directions ?? {}).sort().join(',') !== 'down,left,right,up') {
    throw new Error('角色四向资源合同无效');
  }
  for(const direction of ['up','down','left','right']){
    const character=manifest.directions[direction];
    if(direction==='up'&&character.faceVisible!==false)throw new Error('背面必须为整帧背面资源');
    for(const [name,clock] of Object.entries({working:60,idle:36,syncing:60,error:12})){
      const action=character.actions?.[name];
      if(action?.clockFrames!==clock || action?.frameCount!==12 || action?.fps!==12 || typeof action?.frames!=='string')throw new Error('角色状态时钟或整帧资源无效');
    }
  }
  const assets = structuredClone(referenceAssets);
  for (const direction of ['up', 'down', 'left', 'right']) {
    const character = structuredClone(manifest.directions[direction]);
    if (character.direction !== direction || character.id !== profileId) throw new Error('角色资源身份或方向不匹配');
    character.base = localAsset(character.base, manifestUrl);
    for (const action of Object.values(character.actions ?? {})) action.frames = localAsset(action.frames, manifestUrl);
    assets.directions[direction].character = character;
  }
  return validateDirectionalAssets(assets);
}
export async function loadCharacterProfileAssets(profileId, referenceAssets, { fetcher = fetch, indexUrl = CHARACTER_PROFILE_INDEX_URL } = {}) {
  if (!isRuntimeReadyCharacterProfile(profileId)) throw new Error('角色动画尚未就绪');
  if (profileId === DEFAULT_CHARACTER_PROFILE_ID) return structuredClone(referenceAssets);
  const index = await cachedJson(fetcher, indexUrl);
  if (index.schemaVersion !== 1 || !Object.hasOwn(index.profiles ?? {}, profileId)) throw new Error('角色资源索引无效');
  const manifestUrl = localAsset(index.profiles[profileId].manifest, indexUrl);
  const manifest = await cachedJson(fetcher, manifestUrl);
  return mergeCharacterProfileAssets(referenceAssets, manifest, manifestUrl, profileId);
}
