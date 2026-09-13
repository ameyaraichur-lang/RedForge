'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  type ActionResult,
  type AuditRecord,
  type ConfirmationRequest,
  type OperatorAuthConfig,
  type OperatorPlan,
  type OperatorSessionInfo,
  fetchAudit,
  fetchPlan,
  fetchSession,
  runOperatorCommand,
} from '@/lib/operator';
import {
  type OperatorAuthState,
  type OperatorAuthStatus,
  initializeOperatorAuth,
  resetOperatorAuthCache,
} from '@/lib/operator-auth';

export type OperatorPhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'awaiting_confirmation'
  | 'success'
  | 'error';

export type TranscriptEntry = {
  id: string;
  from: 'operator' | 'you' | 'system';
  text: string;
  ts: string;
};

type OperatorContextValue = {
  authStatus: OperatorAuthStatus;
  authConfig: OperatorAuthConfig | null;
  authError: string | null;
  phase: OperatorPhase;
  micEnabled: boolean;
  privacyMuted: boolean;
  plan: OperatorPlan | null;
  transcript: TranscriptEntry[];
  lastResult: ActionResult | null;
  pendingConfirmation: ConfirmationRequest | null;
  audit: AuditRecord[];
  session: OperatorSessionInfo | null;
  setMicEnabled: (v: boolean) => void;
  setPrivacyMuted: (v: boolean) => void;
  submitText: (text: string, source?: 'text' | 'voice') => Promise<ActionResult | null>;
  confirmPending: () => Promise<ActionResult | null>;
  cancelPending: () => void;
  refreshAuth: () => Promise<void>;
  setSpeakingEnergy: (v: number) => void;
  speakingEnergy: number;
};

const OperatorContext = createContext<OperatorContextValue | null>(null);

const MAX_TRANSCRIPT = 80;
const POLL_MS = 3000;

export function OperatorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<OperatorAuthStatus>('initializing');
  const [authConfig, setAuthConfig] = useState<OperatorAuthConfig | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [phase, setPhase] = useState<OperatorPhase>('idle');
  const [micEnabled, setMicEnabled] = useState(false);
  const [privacyMuted, setPrivacyMuted] = useState(false);
  const [plan, setPlan] = useState<OperatorPlan | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const [speakingEnergy, setSpeakingEnergy] = useState(0);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [session, setSession] = useState<OperatorSessionInfo | null>(null);
  const idRef = useRef(0);
  const successTimer = useRef<number>(0);

  const pushTranscript = useCallback((from: TranscriptEntry['from'], text: string) => {
    idRef.current += 1;
    setTranscript((prev) =>
      [...prev, { id: `t-${idRef.current}`, from, text, ts: new Date().toISOString() }].slice(-MAX_TRANSCRIPT),
    );
  }, []);

  const handleNavigate = useCallback(
    (route: string) => {
      if (route.startsWith('/')) router.push(route);
    },
    [router],
  );

  const applyResult = useCallback(
    (result: ActionResult) => {
      setLastResult(result);
      if (result.requires_confirmation && result.confirmation) {
        setPendingConfirmation(result.confirmation);
        setPhase('awaiting_confirmation');
        pushTranscript('system', `Confirmation required: ${result.confirmation.summary}`);
        return;
      }
      pushTranscript('operator', result.message);
      if (result.ok && result.data?.route && typeof result.data.route === 'string') {
        handleNavigate(result.data.route);
      }
      if (result.ok) {
        setPhase('success');
        window.clearTimeout(successTimer.current);
        successTimer.current = window.setTimeout(() => setPhase('idle'), 2200);
      } else {
        setPhase('error');
      }
    },
    [handleNavigate, pushTranscript],
  );

  const applyAuthState = useCallback((state: OperatorAuthState) => {
    setAuthStatus(state.status);
    setAuthConfig(state.config);
    setAuthError(state.error);
    setSession(state.session);
  }, []);

  const refreshAuth = useCallback(async () => {
    resetOperatorAuthCache();
    const { resetOperatorClientAuthCache } = await import('@/lib/operator');
    resetOperatorClientAuthCache();
    const state = await initializeOperatorAuth();
    applyAuthState(state);
  }, [applyAuthState]);

  useEffect(() => {
    let alive = true;
    void initializeOperatorAuth().then((state) => {
      if (alive) applyAuthState(state);
    });
    return () => {
      alive = false;
    };
  }, [applyAuthState]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let alive = true;
    const poll = async () => {
      const s = await fetchSession();
      if (!alive) return;
      if (!s.authenticated) {
        setAuthStatus('unauthenticated');
        setAuthError(s.error ?? 'Session expired — login required');
        setPlan(null);
        setAudit([]);
        setSession(s);
        return;
      }
      setSession(s);
      const [p, a] = await Promise.all([fetchPlan(), fetchAudit(6)]);
      if (!alive) return;
      if (p) setPlan(p);
      setAudit(a);
    };
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [authStatus]);

  const submitText = useCallback(
    async (text: string, source: 'text' | 'voice' = 'text') => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      if (authStatus === 'initializing') {
        pushTranscript('system', 'Operator session is still initializing — try again in a moment.');
        return null;
      }
      if (authStatus !== 'authenticated') {
        pushTranscript('system', 'Login required before operator commands (secure mode).');
        setPhase('error');
        return null;
      }
      const { isEntryLocked } = await import('@/lib/mission-control-gate');
      if (isEntryLocked()) {
        pushTranscript('system', 'Mission Control not live — complete entry first.');
        setPhase('idle');
        return null;
      }
      pushTranscript('you', trimmed);
      window.dispatchEvent(new CustomEvent('rf:command', { detail: trimmed }));
      setPhase(source === 'voice' ? 'listening' : 'thinking');
      try {
        if (source === 'voice') setPhase('thinking');
        const { parsed, result } = await runOperatorCommand(trimmed, source);
        if (!parsed || !result) {
          pushTranscript('operator', "I don't have that command yet. Try: status, start campaign, open findings.");
          setPhase('idle');
          return null;
        }
        applyResult(result);
        return result;
      } catch (e) {
        pushTranscript('system', `Error: ${e instanceof Error ? e.message : 'unknown'}`);
        setPhase('error');
        return null;
      }
    },
    [applyResult, authStatus, pushTranscript],
  );

  const confirmPending = useCallback(async () => {
    if (!pendingConfirmation) return null;
    if (authStatus !== 'authenticated') return null;
    setPhase('thinking');
    const { executeAction } = await import('@/lib/operator');
    const direct = await executeAction(pendingConfirmation.action, pendingConfirmation.token);
    setPendingConfirmation(null);
    applyResult(direct);
    return direct;
  }, [applyResult, authStatus, pendingConfirmation]);

  const cancelPending = useCallback(() => {
    setPendingConfirmation(null);
    setPhase('idle');
    pushTranscript('system', 'Action cancelled.');
  }, [pushTranscript]);

  useEffect(
    () => () => {
      window.clearTimeout(successTimer.current);
    },
    [],
  );

  const value = useMemo(
    () => ({
      authStatus,
      authConfig,
      authError,
      phase,
      micEnabled,
      privacyMuted,
      plan,
      transcript,
      lastResult,
      pendingConfirmation,
      audit,
      session,
      setMicEnabled,
      setPrivacyMuted,
      submitText,
      confirmPending,
      cancelPending,
      refreshAuth,
      setSpeakingEnergy,
      speakingEnergy,
    }),
    [
      authStatus,
      authConfig,
      authError,
      phase,
      micEnabled,
      privacyMuted,
      plan,
      transcript,
      lastResult,
      pendingConfirmation,
      audit,
      session,
      submitText,
      confirmPending,
      cancelPending,
      refreshAuth,
      speakingEnergy,
    ],
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error('useOperator must be used inside <OperatorProvider>');
  return ctx;
}
