import type { Metadata } from 'next';
import { WorldView } from '@/components/world/world-view';

export const metadata: Metadata = {
  title: 'Orchestrator',
  description: 'RedForge Orchestrator — real-time 3D voice operator entry point',
};

/** Primary entry: World View + Orchestrator (Ops is drill-down via /command). */
export default function OrchestratorPage() {
  return <WorldView />;
}
