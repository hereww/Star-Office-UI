/** The same audited metadata/bubble bridge, retaining V5 screen-only methods. */
import {ConnectedOfficeRuntime} from './runtime.mjs';
import {createOfficeRuntimeAdapter} from '../connected-v4/telemetry-adapter.mjs';
export * from '../connected-v4/telemetry-adapter.mjs';
export const OfficeRuntimeAdapter = createOfficeRuntimeAdapter(ConnectedOfficeRuntime);
export async function loadOfficeRuntimeAdapter(path, options) { return OfficeRuntimeAdapter.load(path, options); }
