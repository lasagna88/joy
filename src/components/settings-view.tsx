"use client";

import { useState, useEffect } from "react";
import { PushToggle } from "./push-toggle";

interface Prefs {
  timezone: string;
  work_start: string;
  work_end: string;
  lunch_start: string;
  lunch_duration_minutes: number;
  buffer_minutes: number;
  travel_buffer_minutes: number;
  min_slack_minutes: number;
  door_knocking_start: string;
  door_knocking_end: string;
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800">
      <span className="text-sm text-zinc-300">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white [color-scheme:dark]"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800">
      <span className="text-sm text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white text-right [color-scheme:dark]"
          min={0}
          max={480}
        />
        <span className="text-xs text-zinc-500 w-8">{suffix}</span>
      </div>
    </div>
  );
}

export function SettingsView() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/preferences");
        if (res.ok) {
          const data = await res.json();
          setPrefs(data);
        }
      } catch {
        // Use defaults from form
      }
    }
    load();
  }, []);

  async function save() {
    if (!prefs) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // Show error
    } finally {
      setSaving(false);
    }
  }

  function update(key: keyof Prefs, value: string | number) {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
  }

  if (!prefs) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="h-40 rounded-xl bg-zinc-900 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Work Hours */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Work Hours
        </h2>
        <TimeInput
          label="Start"
          value={prefs.work_start}
          onChange={(v) => update("work_start", v)}
        />
        <TimeInput
          label="End"
          value={prefs.work_end}
          onChange={(v) => update("work_end", v)}
        />
      </div>

      {/* Door Knocking */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Door Knocking Window
        </h2>
        <TimeInput
          label="Start"
          value={prefs.door_knocking_start}
          onChange={(v) => update("door_knocking_start", v)}
        />
        <TimeInput
          label="End"
          value={prefs.door_knocking_end}
          onChange={(v) => update("door_knocking_end", v)}
        />
      </div>

      {/* Lunch */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Lunch Break
        </h2>
        <TimeInput
          label="Start time"
          value={prefs.lunch_start}
          onChange={(v) => update("lunch_start", v)}
        />
        <NumberInput
          label="Duration"
          value={prefs.lunch_duration_minutes}
          onChange={(v) => update("lunch_duration_minutes", v)}
          suffix="min"
        />
      </div>

      {/* Buffers */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Buffers
        </h2>
        <NumberInput
          label="Between events"
          value={prefs.buffer_minutes}
          onChange={(v) => update("buffer_minutes", v)}
          suffix="min"
        />
        <NumberInput
          label="Travel buffer"
          value={prefs.travel_buffer_minutes}
          onChange={(v) => update("travel_buffer_minutes", v)}
          suffix="min"
        />
        <NumberInput
          label="Daily slack time"
          value={prefs.min_slack_minutes}
          onChange={(v) => update("min_slack_minutes", v)}
          suffix="min"
        />
      </div>

      {/* Timezone */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Timezone
        </h2>
        <div className="flex items-center justify-between py-3">
          <span className="text-sm text-zinc-300">Timezone</span>
          <select
            value={prefs.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white [color-scheme:dark]"
          >
            <option value="America/New_York">Eastern</option>
            <option value="America/Chicago">Central</option>
            <option value="America/Denver">Mountain</option>
            <option value="America/Los_Angeles">Pacific</option>
            <option value="America/Phoenix">Arizona</option>
          </select>
        </div>
      </div>

      {/* Push Notifications */}
      <PushToggle />

      {/* Save Button */}
      <button
        onClick={save}
        disabled={saving}
        className={`w-full rounded-xl py-3 font-medium transition-colors ${
          saved
            ? "bg-green-600 text-white"
            : "bg-blue-600 text-white hover:bg-blue-700"
        } disabled:opacity-50`}
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Preferences"}
      </button>
    </div>
  );
}
