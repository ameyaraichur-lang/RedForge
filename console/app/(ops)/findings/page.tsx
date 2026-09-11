import type { Metadata } from 'next';
import { FindingsScreen } from '@/components/screens/live-sections';

export const metadata: Metadata = { title: 'Findings Explorer' };

export default function FindingsPage() {
  return <FindingsScreen />;
}
