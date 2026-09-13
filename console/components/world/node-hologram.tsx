'use client';

// Node hologram (D8 phase 6) — selecting a constellation node flies the camera
// in and unfolds a holographic detail readout beside the node. For the human
// gates this is the signature moment: the light-bridge opens only when both
// signatures are applied through the panel.

import { useEffect, useMemo, useState } from 'react';
import { eventToLine, useLive, type LiveEvent, type LiveGate, type NodeState } from '@/lib/live';
import { fetchWorldManifest, manifestNodeById } from '@/lib/world-manifest';
import { worldBus } from '@/lib/world-bus';
import { cn } from '@/lib/utils';

const NODE_WHO: Record<string, string[]> = {
  N0_mission_control: ['SYS'],
  N1_recon: ['SYS'],
  N2_attack_strategist: ['SYS'],
  N3_red_operators: ['RED1', 'TARGET'],
  N4_judge: ['JUDGE'],
  N5_mutator: ['SYS'],
  N6_chain_builder: ['SYS'],
  N7_verifier: ['CANARY'],
  N8_scorer: ['SYS'],
  G1_gatekeeper: ['GATE'],
  G2_release: ['GATE'],
};

function nodeStats(id: string, events: LiveEvent[]): Array<[string, string]> {
  const c = worldBus.counters;
  switch (id) {
    case 'N3_red_operators':
      return [['attempts', String(c.attempts)], ['round', String(Math.max(1, c.round))], ['unique techs', String(c.uniqueTechs.size)]];
    case 'N4_judge':
      return [['verdicts', String(c.verdicts)], ['successes', String(c.successes)], ['escalations', String(c.escalated)]];
    case 'N5_mutator':
      return [['mutation cap', '≤ 3'], ['round', String(Math.max(1, c.round))]];
    case 'N6_chain_builder':
      return [['kill chains', String(c.chains)]];
    case 'N8_scorer':
      return [['score', c.scoreTotal !== null ? String(c.scoreTotal) : '——'], ['band', c.scoreBand ?? '——']];
    case 'G1_gatekeeper':
      return [['approved', String(c.gatesApproved)], ['denied', String(c.gatesDenied)]];
    case 'N1_recon':
      return [['surface', 'mapped'], ['shadow tools', 'flagged']];
    default:
      return [];
  }
}

export function NodeHologram({
  nodeId,
  state,
  events,
  onClose,
}: {
  nodeId: string;
  state: NodeState;
  events: LiveEvent[];
  onClose: () => void;
}) {
  const { refreshGates, signGate } = useLive();
  const [gates, setGates] = useState<LiveGate[] | null>(null);
  const [signing, setSigning] = useState(false);
  const [node, setNode] = useState<ReturnType<typeof manifestNodeById>[string] | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchWorldManifest().then((m) => {
      if (alive) setNode(manifestNodeById(m)[nodeId] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [nodeId]);

  useEffect(() => {
    let alive = true;
    if (node?.gate) {
      void refreshGates().then((g) => {
        if (alive) setGates(g);
      });
    }
    return () => {
      alive = false;
    };
  }, [node?.gate, refreshGates]);

  const lines = useMemo(() => {
    const who = NODE_WHO[nodeId] ?? [];
    return events
      .map(eventToLine)
      .filter((l) => who.includes(l.who))
      .slice(-6);
  }, [events, nodeId]);

  const stats = useMemo(() => nodeStats(nodeId, events), [events, nodeId]);
  if (!node) return null;

  const pendingGates = (gates ?? []).filter((g) => !g.decided);

  const sign = async (gateId: string, signer: string) => {
    setSigning(true);
    await signGate(gateId, signer);
    setGates(await refreshGates());
    setSigning(false);
  };

  return (
    <aside
      className="world-holo pointer-events-auto absolute right-6 top-1/2 z-30 w-[300px] -translate-y-1/2"
      style={{ ['--tone' as string]: node.color }}
      aria-label={`${node.name} hologram`}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <p className="world-holo-name font-mono font-bold">{node.name}</p>
          <p className="world-holo-role font-mono uppercase">{node.role} · {node.id.split('_')[0]}</p>
        </div>
        <button type="button" onClick={onClose} className="world-ctl" aria-label="Close hologram">
          esc ✕
        </button>
      </div>

      <div className="world-rule my-2.5" />

      <div className="mb-2 flex items-center gap-2">
        <span className="world-pill-dot" style={{ background: 'var(--tone)' }} />
        <span className="font-mono text-[9px] uppercase tracking-[0.24em]" data-holo-state={state}>
          {state}
        </span>
      </div>

      {stats.length > 0 && (
        <div className="mb-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
          {stats.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">{k}</span>
              <span className="world-holo-val font-mono tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      )}

      {node.gate && (
        <div className="mb-2.5">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.24em] text-dim">
            signature bridge {pendingGates.length === 0 ? '· clear' : `· ${pendingGates.length} awaiting`}
          </p>
          {gates === null && <p className="world-holo-line font-mono">reading gate ledger…</p>}
          {gates !== null && pendingGates.length === 0 && (
            <p className="world-holo-line font-mono world-ok">all gates satisfied · light-bridge open</p>
          )}
          {pendingGates.map((g) => (
            <div key={g.id} className="world-holo-gate">
              <p className="world-holo-line font-mono">{g.justification.slice(0, 96)}</p>
              <p className="world-holo-line font-mono text-dim">
                techniques {g.technique_ids.slice(0, 3).join(', ')}{g.technique_ids.length > 3 ? '…' : ''}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={signing}
                  onClick={() => void sign(g.id, 'operator')}
                  className="world-btn flex-1"
                  aria-label={`Sign gate ${g.id} as operator`}
                >
                  sign · operator
                </button>
                <button
                  type="button"
                  disabled={signing}
                  onClick={() => void sign(g.id, 'red-lead')}
                  className="world-btn flex-1"
                  aria-label={`Sign gate ${g.id} as red lead`}
                >
                  sign · red lead
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className="space-y-[3px]">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.24em] text-dim">recent traffic</p>
          {lines.map((l, i) => (
            <p key={i} className={cn('world-holo-line font-mono', i === lines.length - 1 && 'world-term-hot')}>
              <span className="world-term-t">{l.t}</span> <span className="world-term-who">{l.who}</span> {l.text}
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}
