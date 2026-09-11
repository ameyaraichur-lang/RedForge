import type { Metadata } from 'next';
import { MissionView } from '@/components/screens/mission-view';

export const metadata: Metadata = { title: 'Mission Control' };

export default function MissionPage() {
  return <MissionView />;
}
