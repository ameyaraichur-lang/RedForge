'use client';

// Typed operator client — cookie-based sessions; no sessionStorage, no long-lived secrets.

export type OperatorRole = 'viewer' | 'operator' | 'lead';

export type ActionKind =
  | 'navigate'
  | 'report_status'
  | 'start_campaign'
  | 'inspect_finding'
  | 'review_gate'
  | 'sign_gate'
  | 'abort_campaign'
  | 'open_dossier'
  | 'generate_dossier';

export type OperatorAction = {
  kind: ActionKind;
  params?: Record<string, unknown>;
  correlation_id?: string;
  idempotency_key?: string;
};

export type ConfirmationRequest = {
  token: string;
  action: OperatorAction;
  expires_at: string;
  summary: string;
};

export type ActionResult = {
  ok: boolean;
  kind: ActionKind;
  message: string;
  data?: Record<string, unknown>;
  requires_confirmation?: boolean;
  confirmation?: ConfirmationRequest;
  correlation_id?: string;
};

export type OperatorPlan = {
  campaign_id: string | null;
  running: boolean;
  current_step: string | null;
  plan_steps: string[];
  evidence_count: number;
  blockers: string[];
  next_action: string | null;
  findings_total: number;
  gates_pending: number;
};

export type OperatorAuthConfig = {
  auth_mode: 'demo' | 'secure';
  demo_bootstrap: boolean;
  voice_mode: string;
  session_ttl_minutes: number;
};

export type OperatorSessionInfo = {
  authenticated: boolean;
  actor?: string;
  role?: OperatorRole;
  auth_mode?: string;
  demo_labeled?: boolean;
  label?: string;
  error?: string;
};

const FETCH_INIT: RequestInit = { credentials: 'include' };

let authConfig: OperatorAuthConfig | null = null;
let ensureAuthPromise: Promise<OperatorSessionInfo> | null = null;

export function resetOperatorClientAuthCache(): void {
  authConfig = null;
  ensureAuthPromise = null;
}

export async function fetchAuthConfig(): Promise<OperatorAuthConfig> {
  if (authConfig) return authConfig;
  const r = await fetch('/api/operator/config', { ...FETCH_INIT, cache: 'no-store' });
  authConfig = (await r.json()) as OperatorAuthConfig;
  return authConfig;
}

export async function fetchSession(): Promise<OperatorSessionInfo> {
  const r = await fetch('/api/operator/session', { ...FETCH_INIT, cache: 'no-store' });
  if (!r.ok) {
    return { authenticated: false, error: `session probe failed (${r.status})` };
  }
  return (await r.json()) as OperatorSessionInfo;
}

/** Establish session via demo bootstrap or secure login. Never stores tokens client-side. */
export async function ensureAuthenticated(creds?: { username: string; password: string }): Promise<OperatorSessionInfo> {
  if (creds) {
    const cfg = await fetchAuthConfig();
    if (cfg.auth_mode !== 'secure') {
      throw new Error('Password login only available in secure auth mode');
    }
    const r = await fetch('/api/operator/login', {
      ...FETCH_INIT,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (!r.ok) throw new Error('login failed');
    resetOperatorClientAuthCache();
    const { resetOperatorAuthCache } = await import('@/lib/operator-auth');
    resetOperatorAuthCache();
    return (await r.json()) as OperatorSessionInfo;
  }

  if (!ensureAuthPromise) {
    ensureAuthPromise = (async () => {
      const { initializeOperatorAuth } = await import('@/lib/operator-auth');
      const state = await initializeOperatorAuth();
      if (state.status === 'authenticated' && state.session?.authenticated) {
        return state.session;
      }
      if (state.status === 'unauthenticated') {
        throw new Error('Operator login required');
      }
      throw new Error(state.error ?? 'Operator authentication failed');
    })();
  }
  return ensureAuthPromise;
}

async function authHeaders(): Promise<HeadersInit> {
  await ensureAuthenticated();
  return { 'content-type': 'application/json' };
}

export async function parseIntent(text: string, source: 'text' | 'voice' = 'text') {
  const headers = await authHeaders();
  const r = await fetch('/api/operator/intent', {
    ...FETCH_INIT,
    method: 'POST',
    headers,
    body: JSON.stringify({ text, source }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.intent as { action: OperatorAction; confidence: number; raw_input: string };
}

export async function executeAction(
  action: OperatorAction,
  confirmationToken?: string,
): Promise<ActionResult> {
  const headers = await authHeaders();
  const r = await fetch('/api/operator/action', {
    ...FETCH_INIT,
    method: 'POST',
    headers,
    body: JSON.stringify({ action, confirmation_token: confirmationToken ?? null }),
  });
  return (await r.json()) as ActionResult;
}

/** Protected poll — call only when session is authenticated (cookie already set). */
export async function fetchPlan(): Promise<OperatorPlan | null> {
  const r = await fetch('/api/operator/plan', { ...FETCH_INIT, cache: 'no-store' });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) return null;
  return (await r.json()) as OperatorPlan;
}

export type AuditRecord = {
  id: string;
  action: string;
  decision: string;
  actor: string;
  result_summary: string;
  ts: string;
};

/** Protected poll — call only when session is authenticated (cookie already set). */
export async function fetchAudit(limit = 20): Promise<AuditRecord[]> {
  const r = await fetch(`/api/operator/audit?limit=${limit}`, { ...FETCH_INIT, cache: 'no-store' });
  if (r.status === 401 || r.status === 403) return [];
  if (!r.ok) return [];
  return (await r.json()) as AuditRecord[];
}

export async function voiceStt(opts: {
  simulateTranscript?: string;
  audioB64?: string;
  mimeType?: string;
}) {
  const headers = await authHeaders();
  const r = await fetch('/api/operator/voice/stt', {
    ...FETCH_INIT,
    method: 'POST',
    headers,
    body: JSON.stringify({
      simulate_transcript: opts.simulateTranscript ?? null,
      audio_b64: opts.audioB64 ?? null,
      mime_type: opts.mimeType ?? null,
    }),
  });
  if (!r.ok) return null;
  return (await r.json()) as { transcript: string; confidence: number; adapter: string };
}

export async function voiceTts(text: string) {
  const headers = await authHeaders();
  const r = await fetch('/api/operator/voice/tts', {
    ...FETCH_INIT,
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  });
  if (!r.ok) return null;
  return (await r.json()) as {
    audio_b64: string | null;
    viseme_energy: number;
    adapter: string;
    duration_ms: number;
    mime_type?: string;
  };
}

export async function runOperatorCommand(
  text: string,
  source: 'text' | 'voice' = 'text',
  confirmationToken?: string,
): Promise<{ parsed: boolean; result?: ActionResult; intent?: OperatorAction; blocked?: boolean }> {
  const { isEntryLocked } = await import('@/lib/mission-control-gate');
  if (isEntryLocked()) {
    const blocked: ActionResult = {
      ok: false,
      kind: 'report_status',
      message: 'Mission Control not live — complete entry before operator commands.',
    };
    return { parsed: true, result: blocked, blocked: true };
  }
  const intent = await parseIntent(text, source);
  if (!intent) return { parsed: false };
  const result = await executeAction(intent.action, confirmationToken);
  return { parsed: true, result, intent: intent.action };
}
