"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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
  proposal_prep_minutes: number;
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

interface IntegrationStatus {
  connected: boolean;
  lastSyncAt?: string | null;
  workCalendarId?: string | null;
}

export function SettingsView() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gcalStatus, setGcalStatus] = useState<IntegrationStatus | null>(null);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalMessage, setGcalMessage] = useState<string | null>(null);
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [workCalendarId, setWorkCalendarId] = useState("");
  const [workCalSaving, setWorkCalSaving] = useState(false);
  const [biginStatus, setBiginStatus] = useState<IntegrationStatus | null>(null);
  const [biginLoading, setBiginLoading] = useState(false);
  const [biginMessage, setBiginMessage] = useState<string | null>(null);
  const [biginSyncing, setBiginSyncing] = useState(false);
  const [srStatus, setSrStatus] = useState<IntegrationStatus | null>(null);
  const [srLoading, setSrLoading] = useState(false);
  const [srMessage, setSrMessage] = useState<string | null>(null);
  const [srSyncing, setSrSyncing] = useState(false);
  const [srToken, setSrToken] = useState("");
  const [callbackEnabled, setCallbackEnabled] = useState(false);
  const [callbackStatusMatch, setCallbackStatusMatch] = useState("Callback");
  const [callbackFieldName, setCallbackFieldName] = useState("");
  const [callbackFieldValue, setCallbackFieldValue] = useState("");
  const [callbackPrepMinutes, setCallbackPrepMinutes] = useState(90);
  const [callbackSaving, setCallbackSaving] = useState(false);
  const searchParams = useSearchParams();

  const loadGcalStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google");
      if (res.ok) {
        const data = await res.json();
        setGcalStatus(data);
        if (data.workCalendarId) {
          setWorkCalendarId(data.workCalendarId);
        }
      }
    } catch {
      setGcalStatus({ connected: false });
    }
  }, []);

  const loadBiginStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/bigin");
      if (res.ok) {
        const data = await res.json();
        setBiginStatus(data);
      }
    } catch {
      setBiginStatus({ connected: false });
    }
  }, []);

  const loadSrStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/salesrabbit");
      if (res.ok) {
        const data = await res.json();
        setSrStatus(data);
        if (data.callbackConfig) {
          setCallbackEnabled(data.callbackConfig.enabled ?? false);
          setCallbackStatusMatch(data.callbackConfig.statusNameMatch ?? "Callback");
          setCallbackFieldName(data.callbackConfig.customFieldName ?? "");
          setCallbackFieldValue(data.callbackConfig.customFieldValue ?? "");
          setCallbackPrepMinutes(data.callbackConfig.proposalPrepMinutes ?? 90);
        }
      }
    } catch {
      setSrStatus({ connected: false });
    }
  }, []);

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
    loadGcalStatus();
    loadBiginStatus();
    loadSrStatus();
  }, [loadGcalStatus, loadBiginStatus, loadSrStatus]);

  // Handle OAuth callback redirect params
  useEffect(() => {
    const gcal = searchParams.get("gcal");
    if (gcal === "connected") {
      setGcalMessage("Google Calendar connected successfully!");
      loadGcalStatus();
      setTimeout(() => setGcalMessage(null), 4000);
    } else if (gcal === "error") {
      const reason = searchParams.get("reason") || "unknown";
      setGcalMessage(`Connection failed: ${reason}`);
      setTimeout(() => setGcalMessage(null), 6000);
    }

    const bigin = searchParams.get("bigin");
    if (bigin === "connected") {
      setBiginMessage("Bigin CRM connected successfully!");
      loadBiginStatus();
      setTimeout(() => setBiginMessage(null), 4000);
    } else if (bigin === "error") {
      const reason = searchParams.get("reason") || "unknown";
      setBiginMessage(`Connection failed: ${reason}`);
      setTimeout(() => setBiginMessage(null), 10000);
    }
  }, [searchParams, loadGcalStatus, loadBiginStatus]);

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

  async function connectGoogle() {
    setGcalLoading(true);
    try {
      const res = await fetch("/api/integrations/google", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      }
      setGcalMessage("Failed to start connection. Check Google OAuth config.");
    } catch {
      setGcalMessage("Connection error.");
    } finally {
      setGcalLoading(false);
    }
  }

  async function disconnectGoogle() {
    setGcalLoading(true);
    try {
      const res = await fetch("/api/integrations/google", {
        method: "DELETE",
      });
      if (res.ok) {
        setGcalStatus({ connected: false });
        setGcalMessage("Google Calendar disconnected.");
        setTimeout(() => setGcalMessage(null), 3000);
      }
    } catch {
      setGcalMessage("Failed to disconnect.");
    } finally {
      setGcalLoading(false);
    }
  }

  async function syncGoogle() {
    setGcalSyncing(true);
    try {
      const res = await fetch("/api/integrations/google/sync", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setGcalMessage(
          `Sync complete: ${data.pushed} pushed, ${data.pulled} pulled`
        );
        loadGcalStatus();
      } else {
        setGcalMessage("Sync failed.");
      }
    } catch {
      setGcalMessage("Sync error.");
    } finally {
      setGcalSyncing(false);
      setTimeout(() => setGcalMessage(null), 4000);
    }
  }

  async function saveWorkCalendarId() {
    setWorkCalSaving(true);
    try {
      const res = await fetch("/api/integrations/google", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workCalendarId: workCalendarId.trim() || null }),
      });
      if (res.ok) {
        setGcalMessage("Work calendar ID saved.");
        setTimeout(() => setGcalMessage(null), 3000);
      } else {
        setGcalMessage("Failed to save work calendar ID.");
      }
    } catch {
      setGcalMessage("Failed to save work calendar ID.");
    } finally {
      setWorkCalSaving(false);
      setTimeout(() => setGcalMessage(null), 4000);
    }
  }

  async function connectBigin() {
    setBiginLoading(true);
    try {
      const res = await fetch("/api/integrations/bigin", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      }
      setBiginMessage("Failed to start connection. Check Zoho OAuth config.");
    } catch {
      setBiginMessage("Connection error.");
    } finally {
      setBiginLoading(false);
    }
  }

  async function disconnectBigin() {
    setBiginLoading(true);
    try {
      const res = await fetch("/api/integrations/bigin", {
        method: "DELETE",
      });
      if (res.ok) {
        setBiginStatus({ connected: false });
        setBiginMessage("Bigin CRM disconnected.");
        setTimeout(() => setBiginMessage(null), 3000);
      }
    } catch {
      setBiginMessage("Failed to disconnect.");
    } finally {
      setBiginLoading(false);
    }
  }

  async function syncBigin(wipe = false) {
    setBiginSyncing(true);
    try {
      const url = wipe
        ? "/api/integrations/bigin/sync?wipe=true"
        : "/api/integrations/bigin/sync";
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const prefix = wipe ? `Wiped ${data.wiped} old items. ` : "";
        setBiginMessage(
          `${prefix}Sync complete: ${data.deals} deals, ${data.tasks} tasks imported`
        );
        loadBiginStatus();
      } else {
        setBiginMessage("Sync failed.");
      }
    } catch {
      setBiginMessage("Sync error.");
    } finally {
      setBiginSyncing(false);
      setTimeout(() => setBiginMessage(null), 6000);
    }
  }

  async function connectSalesRabbit() {
    if (!srToken.trim()) {
      setSrMessage("Please enter your API token.");
      setTimeout(() => setSrMessage(null), 3000);
      return;
    }
    setSrLoading(true);
    try {
      const res = await fetch("/api/integrations/salesrabbit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: srToken.trim() }),
      });
      if (res.ok) {
        setSrToken("");
        setSrMessage("SalesRabbit connected successfully!");
        loadSrStatus();
        setTimeout(() => setSrMessage(null), 4000);
      } else {
        const data = await res.json();
        setSrMessage(data.error || "Connection failed.");
        setTimeout(() => setSrMessage(null), 5000);
      }
    } catch {
      setSrMessage("Connection error.");
    } finally {
      setSrLoading(false);
    }
  }

  async function disconnectSalesRabbit() {
    setSrLoading(true);
    try {
      const res = await fetch("/api/integrations/salesrabbit", {
        method: "DELETE",
      });
      if (res.ok) {
        setSrStatus({ connected: false });
        setSrMessage("SalesRabbit disconnected.");
        setTimeout(() => setSrMessage(null), 3000);
      }
    } catch {
      setSrMessage("Failed to disconnect.");
    } finally {
      setSrLoading(false);
    }
  }

  async function syncSalesRabbit(wipe = false) {
    setSrSyncing(true);
    try {
      const url = wipe
        ? "/api/integrations/salesrabbit/sync?wipe=true"
        : "/api/integrations/salesrabbit/sync";
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const prefix = wipe ? `Wiped ${data.wiped} old items. ` : "";
        setSrMessage(
          `${prefix}Sync complete: ${data.newTasks} leads, ${data.newAppointments} appointments`
        );
        loadSrStatus();
      } else {
        setSrMessage("Sync failed.");
      }
    } catch {
      setSrMessage("Sync error.");
    } finally {
      setSrSyncing(false);
      setTimeout(() => setSrMessage(null), 6000);
    }
  }

  async function saveCallbackConfig() {
    setCallbackSaving(true);
    try {
      const res = await fetch("/api/integrations/salesrabbit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackConfig: {
            enabled: callbackEnabled,
            statusNameMatch: callbackStatusMatch,
            customFieldName: callbackFieldName,
            customFieldValue: callbackFieldValue,
            proposalPrepMinutes: callbackPrepMinutes,
          },
        }),
      });
      if (res.ok) {
        setSrMessage("Callback workflow config saved.");
      } else {
        setSrMessage("Failed to save callback config.");
      }
    } catch {
      setSrMessage("Failed to save callback config.");
    } finally {
      setCallbackSaving(false);
      setTimeout(() => setSrMessage(null), 4000);
    }
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

      {/* Google Calendar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Google Calendar
        </h2>

        {gcalMessage && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
              gcalMessage.includes("failed") || gcalMessage.includes("error")
                ? "bg-red-500/10 text-red-400 border border-red-500/30"
                : "bg-green-500/10 text-green-400 border border-green-500/30"
            }`}
          >
            {gcalMessage}
          </div>
        )}

        {gcalStatus?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              <span className="text-sm text-green-400 font-medium">
                Connected
              </span>
            </div>

            {gcalStatus.lastSyncAt && (
              <p className="text-xs text-zinc-500">
                Last sync:{" "}
                {new Date(gcalStatus.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={syncGoogle}
                disabled={gcalSyncing}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                {gcalSyncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={disconnectGoogle}
                disabled={gcalLoading}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>

            <p className="text-xs text-zinc-600">
              Auto-syncs every 30 minutes. Joy events appear in Google
              Calendar and external events show as blockers.
            </p>

            {/* Work Calendar ID */}
            <div className="border-t border-zinc-800 pt-3 mt-3 space-y-2">
              <label className="text-xs text-zinc-400 font-medium block">
                Work Calendar ID
              </label>
              <p className="text-[11px] text-zinc-600">
                To pull work events as blockers, share your aurumsolar.ca
                calendar with scottywc88@gmail.com, then paste the Calendar ID
                (found in Google Calendar settings &rarr; Integrate calendar).
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workCalendarId}
                  onChange={(e) => setWorkCalendarId(e.target.value)}
                  placeholder="e.g. scottc@aurumsolar.ca"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={saveWorkCalendarId}
                  disabled={workCalSaving}
                  className="rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
                >
                  {workCalSaving ? "..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Connect Google Calendar to sync your schedule. Joy events will
              appear on your phone&apos;s calendar and external events will show
              as blockers the AI won&apos;t schedule over.
            </p>
            <button
              onClick={connectGoogle}
              disabled={gcalLoading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {gcalLoading ? "Connecting..." : "Connect Google Calendar"}
            </button>
          </div>
        )}
      </div>

      {/* Bigin CRM */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Bigin CRM
        </h2>

        {biginMessage && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
              biginMessage.includes("failed") || biginMessage.includes("error")
                ? "bg-red-500/10 text-red-400 border border-red-500/30"
                : "bg-green-500/10 text-green-400 border border-green-500/30"
            }`}
          >
            {biginMessage}
          </div>
        )}

        {biginStatus?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              <span className="text-sm text-green-400 font-medium">
                Connected
              </span>
            </div>

            {biginStatus.lastSyncAt && (
              <p className="text-xs text-zinc-500">
                Last sync:{" "}
                {new Date(biginStatus.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => syncBigin()}
                disabled={biginSyncing}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                {biginSyncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={() => syncBigin(true)}
                disabled={biginSyncing}
                className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-400 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
              >
                {biginSyncing ? "..." : "Wipe & Re-sync"}
              </button>
              <button
                onClick={disconnectBigin}
                disabled={biginLoading}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>

            <p className="text-xs text-zinc-600">
              Auto-syncs every 15 minutes. Only your deals and tasks are
              imported. Use &ldquo;Wipe &amp; Re-sync&rdquo; to clear old data
              and re-import with owner filtering.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Connect Bigin CRM to import your pipeline deals and tasks.
              Deal stages are mapped to task categories so the AI can schedule
              them appropriately.
            </p>
            <button
              onClick={connectBigin}
              disabled={biginLoading}
              className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
            >
              {biginLoading ? "Connecting..." : "Connect Bigin CRM"}
            </button>
          </div>
        )}
      </div>

      {/* SalesRabbit */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          SalesRabbit
        </h2>

        {srMessage && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
              srMessage.includes("failed") || srMessage.includes("error") || srMessage.includes("Invalid")
                ? "bg-red-500/10 text-red-400 border border-red-500/30"
                : "bg-green-500/10 text-green-400 border border-green-500/30"
            }`}
          >
            {srMessage}
          </div>
        )}

        {srStatus?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              <span className="text-sm text-green-400 font-medium">
                Connected
              </span>
            </div>

            {srStatus.lastSyncAt && (
              <p className="text-xs text-zinc-500">
                Last sync:{" "}
                {new Date(srStatus.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => syncSalesRabbit()}
                disabled={srSyncing}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                {srSyncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={() => syncSalesRabbit(true)}
                disabled={srSyncing}
                className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-400 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
              >
                {srSyncing ? "..." : "Wipe & Re-sync"}
              </button>
              <button
                onClick={disconnectSalesRabbit}
                disabled={srLoading}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>

            <p className="text-xs text-zinc-600">
              Auto-syncs every 15 minutes. Only your leads are imported. Use
              &ldquo;Wipe &amp; Re-sync&rdquo; to clear old data and re-import
              with owner filtering.
            </p>

            {/* Callback Workflow Config */}
            <div className="border-t border-zinc-800 pt-3 mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-400 font-medium">
                  Callback Workflow
                </label>
                <button
                  onClick={() => {
                    setCallbackEnabled(!callbackEnabled);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    callbackEnabled ? "bg-teal-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      callbackEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <p className="text-[11px] text-zinc-600">
                When a lead is flagged as &ldquo;Callback&rdquo;, automatically
                create a Bigin deal, prep task, and schedule proposal time before
                the appointment.
              </p>

              {callbackEnabled && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-zinc-500 block mb-1">
                      Trigger status name
                    </label>
                    <input
                      type="text"
                      value={callbackStatusMatch}
                      onChange={(e) => setCallbackStatusMatch(e.target.value)}
                      placeholder="Callback"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-teal-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 block mb-1">
                      Or custom field name (optional)
                    </label>
                    <input
                      type="text"
                      value={callbackFieldName}
                      onChange={(e) => setCallbackFieldName(e.target.value)}
                      placeholder="e.g. callback_requested"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-teal-500 focus:outline-none"
                    />
                  </div>

                  {callbackFieldName && (
                    <div>
                      <label className="text-[11px] text-zinc-500 block mb-1">
                        Custom field value (blank = any truthy value)
                      </label>
                      <input
                        type="text"
                        value={callbackFieldValue}
                        onChange={(e) => setCallbackFieldValue(e.target.value)}
                        placeholder="e.g. yes"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-teal-500 focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-zinc-500 block mb-1">
                      Proposal prep time
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={callbackPrepMinutes}
                        onChange={(e) =>
                          setCallbackPrepMinutes(parseInt(e.target.value) || 90)
                        }
                        min={15}
                        max={480}
                        className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white text-right [color-scheme:dark]"
                      />
                      <span className="text-xs text-zinc-500">min</span>
                    </div>
                  </div>

                  <button
                    onClick={saveCallbackConfig}
                    disabled={callbackSaving}
                    className="w-full rounded-lg bg-teal-600/20 border border-teal-500/30 px-3 py-2 text-sm text-teal-400 transition-colors hover:bg-teal-600/30 disabled:opacity-50"
                  >
                    {callbackSaving ? "Saving..." : "Save Callback Config"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Connect SalesRabbit to import leads and field appointments.
              New appointments automatically trigger schedule adjustments.
            </p>
            <input
              type="password"
              value={srToken}
              onChange={(e) => setSrToken(e.target.value)}
              placeholder="Paste your SalesRabbit API token"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <button
              onClick={connectSalesRabbit}
              disabled={srLoading}
              className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              {srLoading ? "Verifying..." : "Connect SalesRabbit"}
            </button>
            <p className="text-xs text-zinc-600">
              Find your API token in SalesRabbit under Settings &gt; API.
              Requires a Pro plan. If your company doesn&apos;t have API access,
              you can add appointments manually via chat.
            </p>
          </div>
        )}
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
