'use client';

import {
  type OperatorAuthConfig,
  type OperatorSessionInfo,
  fetchAuthConfig,
  fetchSession,
} from '@/lib/operator';

export type OperatorAuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';

export type OperatorAuthState = {
  status: OperatorAuthStatus;
  session: OperatorSessionInfo | null;
  config: OperatorAuthConfig | null;
  error: string | null;
};

/** Single-flight demo bootstrap — concurrent callers share one promise. */
let bootstrapPromise: Promise<OperatorAuthState> | null = null;

export function resetOperatorAuthCache(): void {
  bootstrapPromise = null;
}

async function bootstrapDemoSession(): Promise<OperatorSessionInfo> {
  const r = await fetch('/api/operator/bootstrap', { method: 'POST', credentials: 'include' });
  if (!r.ok) {
    throw new Error(`demo bootstrap failed (${r.status})`);
  }
  return (await r.json()) as OperatorSessionInfo;
}

/**
 * Resolve operator auth once before protected polls or actions.
 * Demo mode: bootstrap when configured. Secure mode: never auto-login.
 */
export async function initializeOperatorAuth(): Promise<OperatorAuthState> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    try {
      const config = await fetchAuthConfig();
      let session = await fetchSession();
      if (session.authenticated) {
        return { status: 'authenticated', session, config, error: null };
      }

      if (config.auth_mode === 'demo' && config.demo_bootstrap) {
        await bootstrapDemoSession();
        session = await fetchSession();
        if (session.authenticated) {
          return { status: 'authenticated', session, config, error: null };
        }
        return {
          status: 'error',
          session,
          config,
          error: 'Demo bootstrap completed but session is not authenticated',
        };
      }

      if (config.auth_mode === 'secure') {
        return { status: 'unauthenticated', session, config, error: null };
      }

      return {
        status: 'unauthenticated',
        session,
        config,
        error: 'Operator authentication not configured',
      };
    } catch (err) {
      return {
        status: 'error',
        session: null,
        config: null,
        error: err instanceof Error ? err.message : 'operator auth failed',
      };
    }
  })();

  return bootstrapPromise;
}
