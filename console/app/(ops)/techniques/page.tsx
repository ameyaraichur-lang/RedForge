import type { Metadata } from 'next';
import { TechniquesLibrary } from '@/components/screens/techniques-library';

export const metadata: Metadata = { title: 'Technique Library' };

export default function TechniquesPage() {
  return <TechniquesLibrary />;
}
