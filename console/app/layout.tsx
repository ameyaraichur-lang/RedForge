import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LiveProvider } from '@/lib/live';
import { Copilot } from '@/components/hud/copilot';

export const metadata: Metadata = {
  title: {
    default: 'RedForge Console',
    template: '%s · RedForge Console',
  },
  description:
    'RedForge Console — Red-team orchestration, findings adjudication, gates, scorecard and regulatory dossier for LLM agent systems. Live SSE mission control with the World View (D8) cinematic interface.',
};

export const viewport: Viewport = {
  themeColor: '#0a0e14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LiveProvider>
          {children}
          <Copilot />
        </LiveProvider>
      </body>
    </html>
  );
}
