import { BottomNav } from "@/components/bottom-nav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 pb-20">
      <main className="mx-auto max-w-lg px-4 pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
