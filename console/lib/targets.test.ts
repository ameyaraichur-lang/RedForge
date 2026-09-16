import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DEFAULT_TARGET_PICKER,
  buildTargetPayload,
  formatCapsClamped,
  parseTargetIdFromCommand,
  postCampaignStart,
  selectableTargets,
  targetPickerDisabledReason,
  validateApiKeyEnvName,
  type TargetSpec,
} from '@/lib/targets';

const FIXTURE_CATALOGUE: TargetSpec[] = [
  {
    id: 'TGT-01',
    name: 'Chatbot',
    target_class: 'chatbot',
    interface: 'model_api',
    base_url: '',
    packs: ['PIN'],
    prod_safety_notes: 'rate capped',
    asset_criticality: 4,
  },
  {
    id: 'TGT-DEMO',
    name: 'RedForge vulnerable demo copilot',
    target_class: 'employee_copilot',
    interface: 'model_api',
    base_url: 'http://127.0.0.1:8765',
    packs: ['PIN', 'EXF'],
    prod_safety_notes: 'Local fixture',
    asset_criticality: 2,
  },
  {
    id: 'ASTRA',
    name: 'Astra LLM judge',
    target_class: 'ai_gateway',
    interface: 'model_api',
    base_url: '',
    packs: [],
    prod_safety_notes: 'judge only',
    asset_criticality: 1,
  },
];

describe('selectableTargets', () => {
  it('lists catalogue targets and excludes Astra judge entries', () => {
    const rows = selectableTargets(FIXTURE_CATALOGUE);
    expect(rows.map((t) => t.id)).toEqual(['TGT-01', 'TGT-DEMO']);
  });
});

describe('targetPickerDisabledReason', () => {
  it('allows TGT-DEMO default without operator role', () => {
    expect(targetPickerDisabledReason(DEFAULT_TARGET_PICKER, 'viewer')).toBeNull();
  });

  it('blocks non-operators from explicit catalogue targets', () => {
    const reason = targetPickerDisabledReason({ ...DEFAULT_TARGET_PICKER, targetId: 'TGT-04' }, 'viewer');
    expect(reason).toMatch(/operator login required/i);
  });
});

describe('buildTargetPayload', () => {
  it('omits target for demo default with no overrides', () => {
    expect(buildTargetPayload(DEFAULT_TARGET_PICKER)).toBeUndefined();
  });

  it('includes target_id for explicit catalogue selection', () => {
    expect(buildTargetPayload({ ...DEFAULT_TARGET_PICKER, targetId: 'TGT-04' })).toEqual({
      target_id: 'TGT-04',
    });
  });
});

describe('validateApiKeyEnvName', () => {
  it('requires RF_TARGET_CRED_* naming', () => {
    expect(validateApiKeyEnvName('sk-live-secret')).toMatch(/RF_TARGET_CRED_/);
    expect(validateApiKeyEnvName('RF_TARGET_CRED_ACME')).toBeNull();
  });
});

describe('postCampaignStart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces server 400 error text verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'no authorisation-to-test on file for TGT-04' }),
      })),
    );
    const out = await postCampaignStart(null, 1, { target_id: 'TGT-04' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('no authorisation-to-test on file for TGT-04');
  });
});

describe('parseTargetIdFromCommand', () => {
  it('extracts catalogue ids from start phrases', () => {
    expect(parseTargetIdFromCommand('start campaign on TGT-04')).toBe('TGT-04');
    expect(parseTargetIdFromCommand('launch campaign tgt demo')).toBe('TGT-DEMO');
  });

  it('ignores astra', () => {
    expect(parseTargetIdFromCommand('start campaign on astra')).toBeNull();
  });
});

describe('formatCapsClamped', () => {
  it('formats requested vs applied caps', () => {
    const lines = formatCapsClamped({ max_attempts: { requested: 600, applied: 120 } });
    expect(lines[0]).toContain('600');
    expect(lines[0]).toContain('120');
  });
});
