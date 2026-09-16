/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CampaignTargetPicker } from '@/components/ui/campaign-target-picker';
import { DEFAULT_TARGET_PICKER, type TargetSpec } from '@/lib/targets';

const CATALOGUE: TargetSpec[] = [
  {
    id: 'TGT-04',
    name: 'Tool-calling agent',
    target_class: 'tool_agent',
    interface: 'tool_schema',
    base_url: '',
    packs: ['PIN'],
    prod_safety_notes: 'Sandbox tenant with simulated tools',
    asset_criticality: 4,
  },
  {
    id: 'TGT-DEMO',
    name: 'RedForge vulnerable demo copilot',
    target_class: 'employee_copilot',
    interface: 'model_api',
    base_url: 'http://127.0.0.1:8765',
    packs: ['PIN', 'EXF'],
    prod_safety_notes: 'Local fixture — seeded flaw per pack',
    asset_criticality: 2,
  },
];

describe('CampaignTargetPicker', () => {
  afterEach(() => cleanup());

  it('renders catalogue targets from the API list', () => {
    render(
      <CampaignTargetPicker
        value={DEFAULT_TARGET_PICKER}
        onChange={vi.fn()}
        operatorRole="operator"
        catalogueOverride={CATALOGUE}
      />,
    );
    expect(screen.getByLabelText(/target asset/i)).toBeTruthy();
    expect(screen.getByRole('option', { name: /TGT-04/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /TGT-DEMO/i })).toBeTruthy();
    expect(screen.getByTestId('target-constraints').textContent).toMatch(/Local fixture/);
  });

  it('shows disabled reason for non-operator explicit target selection', () => {
    render(
      <CampaignTargetPicker
        value={{ ...DEFAULT_TARGET_PICKER, targetId: 'TGT-04' }}
        onChange={vi.fn()}
        operatorRole="viewer"
        catalogueOverride={CATALOGUE}
      />,
    );
    const lock = screen.getByTestId('target-picker-auth-lock');
    expect(lock.textContent).toMatch(/operator login required/i);
    expect(screen.getByTestId('campaign-target-picker').hasAttribute('disabled')).toBe(true);
  });

  it('never offers Astra as a selectable target', () => {
    render(
      <CampaignTargetPicker
        value={DEFAULT_TARGET_PICKER}
        onChange={vi.fn()}
        operatorRole="operator"
        catalogueOverride={[
          ...CATALOGUE,
          {
            id: 'ASTRA',
            name: 'Astra judge deployment',
            target_class: 'ai_gateway',
            interface: 'model_api',
            base_url: '',
            packs: [],
            prod_safety_notes: 'judge only',
            asset_criticality: 1,
          },
        ]}
      />,
    );
    expect(screen.queryByRole('option', { name: /astra/i })).toBeNull();
  });

  it('uses env var name field only — no raw secret input', () => {
    render(
      <CampaignTargetPicker
        value={{ ...DEFAULT_TARGET_PICKER, showAdvanced: true }}
        onChange={vi.fn()}
        operatorRole="operator"
        catalogueOverride={CATALOGUE}
      />,
    );
    const field = screen.getByTestId('api-key-env-field');
    expect(field.getAttribute('type')).toBe('text');
    expect(field.getAttribute('placeholder')).toMatch(/RF_TARGET_CRED_/);
    expect(screen.getByText(/never entered here/i)).toBeTruthy();
    expect(screen.queryByLabelText(/api key$/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/sk-/i)).toBeNull();
  });
});
