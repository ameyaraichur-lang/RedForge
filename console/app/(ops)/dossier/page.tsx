import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { PackBadge } from '@/components/ui/badge';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';
import { DOSSIER, frameworkOf } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Regulatory Dossier' };

const FRAMEWORK_TONE: Record<string, string> = {
  EU: 'border-acc/40 bg-acc/10 text-acc',
  ISO: 'border-ok/40 bg-ok/10 text-ok',
  NIST: 'border-warn/40 bg-warn/10 text-warn',
  OWASP: 'border-crit/40 bg-crit/10 text-crit',
};

function readinessTone(v: number): string {
  if (v >= 65) return 'bg-ok';
  if (v >= 50) return 'bg-acc';
  if (v >= 40) return 'bg-warn';
  return 'bg-crit';
}

export default function DossierPage() {
  return (
    <>
      <PageHeader
        title="Regulatory Dossier"
        sub="Pack-to-control compliance matrix with readiness. Maps RedForge attack packs to EU AI Act Art. 15.2, ISO/IEC 42001 Annex A, NIST AI RMF and OWASP agentic guidance."
        actions={
          <div className="flex flex-wrap gap-2">
            {['export pdf', 'export json', 'evidence bundle (.zip)'].map((label) => (
              <button
                key={label}
                type="button"
                title="Visual stub — export engine lands in M6b"
                className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-2 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-mut transition-colors hover:border-line-2 hover:text-slate-200"
              >
                <Icon name="download" className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        }
      />

      <Panel title="Compliance Matrix" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['pack', 'mapped controls', 'findings', 'readiness', 'last audit'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="sticky top-0 border-b border-line bg-ink-2 px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DOSSIER.map((row) => (
                <tr key={row.pack} className="border-b border-line/60 align-top last:border-b-0 hover:bg-acc/5">
                  <td className="px-4 py-3">
                    <PackBadge pack={row.pack} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-xl flex-wrap gap-1.5">
                      {row.controls.map((c) => {
                        const fw = frameworkOf(c);
                        return (
                          <span
                            key={c}
                            title={c}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
                              FRAMEWORK_TONE[fw],
                            )}
                          >
                            <span className="font-semibold">{fw}</span>
                            <span className="opacity-80">{c.replace(/^(EU|ISO|NIST|OWASP)-/, '')}</span>
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[12px] text-slate-300">{row.findings} linked</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-2">
                        <span className={cn('block h-full rounded-full', readinessTone(row.readiness))} style={{ width: `${row.readiness}%` }} />
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-300">{row.readiness}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[11px] text-mut">{row.lastAudit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Framework Legend">
          <ul className="space-y-2">
            {Object.entries(FRAMEWORK_TONE).map(([fw, tone]) => (
              <li key={fw} className="flex items-center gap-2.5">
                <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold', tone)}>{fw}</span>
                <span className="text-[12px] text-mut">
                  {fw === 'EU' ? 'EU AI Act · Art. 15.2 (high-risk AI requirements)' : null}
                  {fw === 'ISO' ? 'ISO/IEC 42001 · Annex A controls' : null}
                  {fw === 'NIST' ? 'NIST AI RMF · functions & outcomes' : null}
                  {fw === 'OWASP' ? 'OWASP Agentic / LLM Top 10' : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Coverage Notes">
          <ul className="space-y-2 text-[12px] leading-relaxed text-mut">
            <li className="border-l-2 border-warn/50 pl-3">
              SUP (35%) is the weakest pack — ISO A.10.6 supplier controls lack signed attestations for 2 MCP servers.
            </li>
            <li className="border-l-2 border-warn/50 pl-3">
              MEM (41%) evidence gaps: corpus ingestion chain-of-custody missing for feedback-form submissions.
            </li>
            <li className="border-l-2 border-ok/50 pl-3">
              CON (72%) is strongest — gateway rate-limit and breaker evidence is fully scripted and reproducible.
            </li>
            <li className="border-l-2 border-acc/50 pl-3">
              OWASP Agentic Top 10 mapping is cross-pack (AGE/MEM/SUP) per blueprint section 7.
            </li>
          </ul>
        </Panel>

        <Panel title="Audit Status">
          <div className="space-y-2.5 font-mono text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-dim">dossier version</span>
              <span className="text-slate-300">v0.6 · m6a</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-dim">controls mapped</span>
              <span className="text-slate-300">19 unique ids</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-dim">evidence sealed</span>
              <span className="text-slate-300">61% of confirmed findings</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-dim">next audit window</span>
              <span className="text-slate-300">2026-09-22</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-dim">export engine</span>
              <span className="text-warn">stub · m6b</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
