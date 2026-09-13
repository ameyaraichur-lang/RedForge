'use client';

import { useEffect, useState } from 'react';
import { useOperator } from '@/lib/operator-context';

export function EntryAuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const op = useOperator();
  const { refreshAuth } = op;
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (op.authStatus === 'authenticated') onAuthenticated();
  }, [op.authStatus, onAuthenticated]);

  if (op.authStatus === 'authenticated') return null;

  return (
    <div className="w-[min(420px,calc(100vw-2rem))] rounded border border-warn/40 bg-ink/90 p-4 text-center backdrop-blur-md">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-warn">secure operator login required</p>
      {err && <p className="mt-2 font-mono text-[10px] text-crit">{err}</p>}
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          const { ensureAuthenticated } = await import('@/lib/operator');
          const session = await ensureAuthenticated({ username: user, password: pass });
          if (session.authenticated) {
            await refreshAuth();
            onAuthenticated();
          } else setErr('Login failed — check credentials');
        }}
      >
        <input
          className="rounded border border-line/50 bg-panel/60 px-3 py-2 font-mono text-[11px] text-slate-100"
          placeholder="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          aria-label="Username"
        />
        <input
          type="password"
          className="rounded border border-line/50 bg-panel/60 px-3 py-2 font-mono text-[11px] text-slate-100"
          placeholder="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-label="Password"
        />
        <button type="submit" className="world-btn text-[10px]">
          sign in
        </button>
      </form>
    </div>
  );
}
