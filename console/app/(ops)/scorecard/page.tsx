import type { Metadata } from 'next';
import { ScorecardScreen } from '@/components/screens/live-sections';

export const metadata: Metadata = { title: 'Scorecard' };

export default function ScorecardPage() {
  return <ScorecardScreen />;
}
