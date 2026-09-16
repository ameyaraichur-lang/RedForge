/** Target catalogue types and campaign target selection helpers. */

export const DEMO_TARGET_ID = 'TGT-DEMO';

export type TargetSpec = {
  id: string;
  name: string;
  target_class: string;
  interface: string;
  base_url: string;
  packs: string[];
  prod_safety_notes: string;
  asset_criticality: number;
};

export type TargetRequestPayload = {
  target_id?: string;
  provider?: string;
  base_url?: string;
  api_key_env?: string;
};

export type TargetPickerState = {
  targetId: string;
  provider: string;
  baseUrl: string;
  apiKeyEnv: string;
  showAdvanced: boolean;
};

export type OperatorRole = 'viewer' | 'operator' | 'lead';

export const DEFAULT_TARGET_PICKER: TargetPickerState = {
  targetId: DEMO_TARGET_ID,
  provider: '',
  baseUrl: '',
  apiKeyEnv: '',
  showAdvanced: false,
};

const JUDGE_ONLY_IDS = new Set(['ASTRA']);
const JUDGE_ONLY_NAMES = /\bastra\b/i;

/** Catalogue entries selectable as campaign targets — never the LLM judge. */
export function selectableTargets(catalogue: TargetSpec[]): TargetSpec[] {
  return catalogue.filter(
    (t) => !JUDGE_ONLY_IDS.has(t.id.toUpperCase()) && !JUDGE_ONLY_NAMES.test(t.name),
  );
}

export function isOperatorOrAbove(role: OperatorRole | undefined): boolean {
  return role === 'operator' || role === 'lead';
}

export function hasAdvancedOverrides(state: TargetPickerState): boolean {
  return Boolean(state.provider.trim() || state.baseUrl.trim() || state.apiKeyEnv.trim());
}

/** True when the start request would include an explicit target object. */
export function requiresExplicitTargetAuth(state: TargetPickerState): boolean {
  if (hasAdvancedOverrides(state)) return true;
  return state.targetId.trim().toUpperCase() !== DEMO_TARGET_ID;
}

export function targetPickerDisabledReason(
  state: TargetPickerState,
  role: OperatorRole | undefined,
): string | null {
  if (!requiresExplicitTargetAuth(state)) return null;
  if (isOperatorOrAbove(role)) return null;
  return 'Operator login required to choose a catalogue target or override endpoint settings.';
}

export function buildTargetPayload(state: TargetPickerState): TargetRequestPayload | undefined {
  if (!requiresExplicitTargetAuth(state)) return undefined;
  const payload: TargetRequestPayload = { target_id: state.targetId.trim().toUpperCase() };
  const provider = state.provider.trim();
  const baseUrl = state.baseUrl.trim();
  const apiKeyEnv = state.apiKeyEnv.trim();
  if (provider) payload.provider = provider;
  if (baseUrl) payload.base_url = baseUrl;
  if (apiKeyEnv) payload.api_key_env = apiKeyEnv;
  return payload;
}

export function validateApiKeyEnvName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^RF_TARGET_CRED_[A-Z0-9_]+$/.test(trimmed)) {
    return 'Must name an existing env var matching RF_TARGET_CRED_* — never paste a secret.';
  }
  return null;
}

export async function fetchTargetCatalogue(): Promise<TargetSpec[]> {
  const r = await fetch('/api/targets', { cache: 'no-store' });
  if (!r.ok) throw new Error(`targets catalogue unavailable (${r.status})`);
  return (await r.json()) as TargetSpec[];
}

export type CampaignStartResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

export async function postCampaignStart(
  packs: string[] | null,
  rounds: number,
  target?: TargetRequestPayload,
): Promise<CampaignStartResult> {
  const body: Record<string, unknown> = { packs, rounds };
  if (target) body.target = target;
  const r = await fetch('/api/campaign/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const err = typeof data.error === 'string' ? data.error : typeof data.detail === 'string' ? data.detail : `start failed (${r.status})`;
    return { ok: false, error: err, status: r.status };
  }
  return { ok: true, data };
}

export type CapsClamped = Record<string, { requested: unknown; applied: unknown }>;

export function formatCapsClamped(clamped: CapsClamped): string[] {
  return Object.entries(clamped).map(
    ([field, v]) => `${field}: requested ${String(v.requested)} → applied ${String(v.applied)}`,
  );
}

/** Parse "start campaign on TGT-04" style operator commands (client-side hint). */
export function parseTargetIdFromCommand(text: string): string | null {
  const m = text.match(/\b(tgt[-\s]?(?:demo|\d{2}))\b/i);
  if (!m) return null;
  let raw = m[1].toUpperCase().replace(/\s+/g, '-');
  if (!raw.startsWith('TGT-')) raw = `TGT-${raw.replace(/^TGT-?/, '')}`;
  if (raw === 'TGT-DEMO' || /^TGT-\d{2}$/.test(raw)) {
    if (/astra/i.test(raw)) return null;
    return raw;
  }
  return null;
}
