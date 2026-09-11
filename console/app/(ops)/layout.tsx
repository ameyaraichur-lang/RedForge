import { Sidebar } from '@/components/sidebar';
import { TopBar } from '@/components/topbar';
import { BriefingBar } from '@/components/hud/briefing-bar';

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-6 py-6">{children}</main>
        <footer className="border-t border-line px-6 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            redforge console · live sse + world view (d8) · demo provider (d3) · all times utc
          </p>
        </footer>
      </div>
      <BriefingBar />
    </div>
  );
}
