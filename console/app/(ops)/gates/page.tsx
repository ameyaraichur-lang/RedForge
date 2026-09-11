import type { Metadata } from 'next';
import { GatesScreen } from '@/components/screens/live-sections';

export const metadata: Metadata = { title: 'Gatekeeper Console' };

export default function GatesPage() {
  return <GatesScreen />;
}
