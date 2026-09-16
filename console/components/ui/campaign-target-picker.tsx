'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TARGET_PICKER,
  type OperatorRole,
  type TargetPickerState,
  type TargetSpec,
  buildTargetPayload,
  fetchTargetCatalogue,
  hasAdvancedOverrides,
  selectableTargets,
  targetPickerDisabledReason,
  validateApiKeyEnvName,
} from '@/lib/targets';

export type CampaignTargetPickerProps = {
  value: TargetPickerState;
  onChange: (next: TargetPickerState) => void;
  operatorRole?: OperatorRole;
  disabled?: boolean;
  running?: boolean;
  variant?: 'ops' | 'world';
  /** Test hook — skip network fetch when catalogue is supplied. */
  catalogueOverride?: TargetSpec[];
};

function criticalityTone(n: number): string {
  if (n >= 5) return 'text-crit';
  if (n >= 4) return 'text-warn';
  if (n >= 3) return 'text-acc';
  return 'text-ok';
}

export function CampaignTargetPicker({
  value,
  onChange,
  operatorRole,
  disabled = false,
  running = false,
  variant = 'ops',
  catalogueOverride,
}: CampaignTargetPickerProps) {
  const baseId = useId();
  const [catalogue, setCatalogue] = useState<TargetSpec[]>(catalogueOverride ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (catalogueOverride) {
      setCatalogue(catalogueOverride);
      return;
    }
    let alive = true;
    void fetchTargetCatalogue()
      .then((rows) => {
        if (alive) setCatalogue(selectableTargets(rows));
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'catalogue unavailable');
      });
    return () => {
      alive = false;
    };
  }, [catalogueOverride]);

  const options = useMemo(() => selectableTargets(catalogue), [catalogue]);
  const selected = options.find((t) => t.id === value.targetId) ?? options[0];
  const authReason = targetPickerDisabledReason(value, operatorRole);
  const locked = disabled || running || Boolean(authReason);
  const apiKeyErr = validateApiKeyEnvName(value.apiKeyEnv);
  const explicit = hasAdvancedOverrides(value) || value.targetId !== DEFAULT_TARGET_PICKER.targetId;

  const setField = <K extends keyof TargetPickerState>(key: K, v: TargetPickerState[K]) => {
    onChange({ ...value, [key]: v });
  };

  const selectCls = variant === 'world' ? 'world-ctl w-full bg-transparent font-mono text-[10px]' : 'ops-select w-full max-w-md';
  const labelCls = variant === 'world' ? 'font-mono text-[9px] uppercase tracking-[0.2em] text-dim' : 'font-mono text-[10px] uppercase tracking-[0.14em] text-dim';

  return (
    <fieldset
      className={cn('space-y-3', locked && 'opacity-90')}
      aria-label="Campaign target selection"
      disabled={locked}
      data-testid="campaign-target-picker"
    >
      {loadError && (
        <p className="font-mono text-[11px] text-warn" role="status">
          {loadError}
        </p>
      )}

      {authReason && (
        <p className="rounded border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-[11px] text-warn" role="status" data-testid="target-picker-auth-lock">
          {authReason}
        </p>
      )}

      <div>
        <label htmlFor={`${baseId}-target`} className={labelCls}>
          target asset
        </label>
        <select
          id={`${baseId}-target`}
          className={cn('mt-1', selectCls)}
          value={value.targetId}
          onChange={(e) => setField('targetId', e.target.value)}
          aria-describedby={`${baseId}-target-help`}
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.name} · crit {t.asset_criticality}/5
            </option>
          ))}
        </select>
        <p id={`${baseId}-target-help`} className="mt-1 font-mono text-[10px] text-dim">
          Default {DEFAULT_TARGET_PICKER.targetId} uses deployer settings — no operator login required.
          {explicit ? ' Explicit target selection is audited.' : ''}
        </p>
      </div>

      {selected && (
        <div
          className={cn(
            'rounded border px-3 py-2.5',
            variant === 'world' ? 'border-line/40 bg-panel/40' : 'border-line bg-ink-2',
          )}
          data-testid="target-constraints"
        >
          <p className={labelCls}>operating constraints</p>
          <p className="mt-1 font-mono text-[11px] text-slate-200">
            criticality{' '}
            <span className={criticalityTone(selected.asset_criticality)}>
              {selected.asset_criticality}/5
            </span>
            {' · '}
            {selected.target_class}
          </p>
          {selected.prod_safety_notes && (
            <p className="mt-2 border-l-2 border-warn/50 pl-3 font-mono text-[11px] leading-relaxed text-mut">
              {selected.prod_safety_notes}
            </p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          className={cn(
            variant === 'world' ? 'world-ctl text-[9px]' : 'font-mono text-[10px] uppercase tracking-[0.12em] text-acc hover:underline',
          )}
          aria-expanded={value.showAdvanced}
          aria-controls={`${baseId}-advanced`}
          onClick={() => setField('showAdvanced', !value.showAdvanced)}
        >
          {value.showAdvanced ? 'hide' : 'show'} advanced endpoint overrides
        </button>
      </div>

      {value.showAdvanced && (
        <div id={`${baseId}-advanced`} className="space-y-3 border-l-2 border-acc/30 pl-3">
          <p className="font-mono text-[10px] leading-relaxed text-mut">
            Credentials are never entered here. Supply the <strong className="font-normal text-slate-300">name</strong> of a
            server-side env var (RF_TARGET_CRED_*) — values would be echoed into campaign events and the evidence bundle.
          </p>
          <div>
            <label htmlFor={`${baseId}-provider`} className={labelCls}>
              provider
            </label>
            <input
              id={`${baseId}-provider`}
              type="text"
              value={value.provider}
              onChange={(e) => setField('provider', e.target.value)}
              placeholder="openai-compatible"
              className={cn('mt-1 w-full bg-transparent font-mono text-[11px] outline-none', variant === 'world' ? 'world-ctl' : 'ops-select')}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`${baseId}-base-url`} className={labelCls}>
              base url
            </label>
            <input
              id={`${baseId}-base-url`}
              type="url"
              value={value.baseUrl}
              onChange={(e) => setField('baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
              className={cn('mt-1 w-full bg-transparent font-mono text-[11px] outline-none', variant === 'world' ? 'world-ctl' : 'ops-select')}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`${baseId}-api-key-env`} className={labelCls}>
              api key env var name
            </label>
            <input
              id={`${baseId}-api-key-env`}
              type="text"
              value={value.apiKeyEnv}
              onChange={(e) => setField('apiKeyEnv', e.target.value.toUpperCase())}
              placeholder="RF_TARGET_CRED_ACME"
              className={cn('mt-1 w-full bg-transparent font-mono text-[11px] outline-none', variant === 'world' ? 'world-ctl' : 'ops-select')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(apiKeyErr)}
              aria-describedby={apiKeyErr ? `${baseId}-api-key-err` : undefined}
              data-testid="api-key-env-field"
            />
            {apiKeyErr && (
              <p id={`${baseId}-api-key-err`} className="mt-1 font-mono text-[10px] text-crit" role="alert">
                {apiKeyErr}
              </p>
            )}
          </div>
        </div>
      )}

      <input type="hidden" data-testid="target-payload-preview" value={JSON.stringify(buildTargetPayload(value) ?? null)} readOnly aria-hidden />
    </fieldset>
  );
}
