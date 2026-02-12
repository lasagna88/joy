import { Suspense } from "react";
import { SettingsView } from "@/components/settings-view";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-zinc-500">Loading settings...</div>}>
      <SettingsView />
    </Suspense>
  );
}
