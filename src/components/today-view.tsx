"use client";

import { useState, useEffect, useCallback } from "react";
import { VoiceButton } from "./voice-button";

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  color?: string;
  isBlocker?: boolean;
  metadata?: { category?: string };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getDurationMinutes(start: string, end: string): number {
  return Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60000
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function isCurrentEvent(start: string, end: string): boolean {
  const now = Date.now();
  return now >= new Date(start).getTime() && now < new Date(end).getTime();
}

function isPastEvent(end: string): boolean {
  return Date.now() > new Date(end).getTime();
}

const categoryStyles: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  door_knocking: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-300", dot: "bg-green-400" },
  appointment:   { bg: "bg-blue-500/10",  border: "border-blue-500/30",  text: "text-blue-300",  dot: "bg-blue-400" },
  follow_up:     { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-300", dot: "bg-amber-400" },
  admin:         { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-300", dot: "bg-purple-400" },
  goal_work:     { bg: "bg-cyan-500/10",  border: "border-cyan-500/30",  text: "text-cyan-300",  dot: "bg-cyan-400" },
  personal:      { bg: "bg-pink-500/10",  border: "border-pink-500/30",  text: "text-pink-300",  dot: "bg-pink-400" },
  lunch:         { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-300", dot: "bg-yellow-400" },
  travel:        { bg: "bg-slate-500/10", border: "border-slate-500/30", text: "text-slate-400", dot: "bg-slate-400" },
  buffer:        { bg: "bg-zinc-500/10",  border: "border-zinc-500/30",  text: "text-zinc-400",  dot: "bg-zinc-500" },
  other:         { bg: "bg-zinc-500/10",  border: "border-zinc-500/30",  text: "text-zinc-300",  dot: "bg-zinc-400" },
};

export function TodayView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [planSummary, setPlanSummary] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events/today");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // Will show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleVoiceQuickAdd = useCallback(async (text: string) => {
    setVoiceStatus("Sending to Papwa...");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setVoiceStatus(data.message || "Done!");
        await fetchEvents();
      } else {
        setVoiceStatus("Failed to process. Try again.");
      }
    } catch {
      setVoiceStatus("Connection error.");
    }
    setTimeout(() => setVoiceStatus(null), 4000);
  }, [fetchEvents]);

  async function planDay() {
    setPlanning(true);
    setPlanSummary(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: new Date().toISOString().split("T")[0],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPlanSummary(data.summary);
        // Refresh events
        await fetchEvents();
      } else {
        setPlanSummary("Failed to plan day. Check that the API key is configured.");
      }
    } catch {
      setPlanSummary("Connection error. Is the server running?");
    } finally {
      setPlanning(false);
    }
  }

  // Calculate stats
  const totalMinutes = events.reduce(
    (acc, e) => acc + getDurationMinutes(e.startTime, e.endTime),
    0
  );
  const completedMinutes = events
    .filter((e) => isPastEvent(e.endTime))
    .reduce((acc, e) => acc + getDurationMinutes(e.startTime, e.endTime), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{getGreeting()}, Scott</h1>
          <p className="text-zinc-400">{formatDate()}</p>
        </div>
        {events.length > 0 && (
          <div className="text-right">
            <p className="text-sm font-medium text-zinc-300">
              {formatDuration(completedMinutes)}{" "}
              <span className="text-zinc-500">/ {formatDuration(totalMinutes)}</span>
            </p>
            <p className="text-xs text-zinc-500">{events.length} blocks</p>
          </div>
        )}
      </div>

      {/* Briefing / Plan Summary */}
      {planSummary && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-2 w-2 rounded-full bg-blue-400" />
            <span className="text-sm font-medium text-blue-400">
              Plan Summary
            </span>
          </div>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">
            {planSummary}
          </p>
        </div>
      )}

      {/* Plan My Day Button */}
      <button
        onClick={planDay}
        disabled={planning}
        className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {planning ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Planning your day...
          </span>
        ) : events.length > 0 ? (
          "Replan my day"
        ) : (
          "Plan my day"
        )}
      </button>

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-zinc-900 animate-pulse"
            />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <svg
            className="h-14 w-14 text-zinc-700 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
            />
          </svg>
          <p className="text-zinc-500 text-lg font-medium">No schedule yet</p>
          <p className="text-zinc-600 text-sm mt-1">
            Add tasks via Chat, then tap &quot;Plan my day&quot;
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const category =
              (event.metadata?.category as string) || "other";
            const style = categoryStyles[category] || categoryStyles.other;
            const current = isCurrentEvent(event.startTime, event.endTime);
            const past = isPastEvent(event.endTime);
            const duration = getDurationMinutes(
              event.startTime,
              event.endTime
            );

            return (
              <div
                key={event.id}
                className={`rounded-xl border p-3.5 transition-all ${style.bg} ${style.border} ${
                  current
                    ? "ring-1 ring-blue-400/50 shadow-lg shadow-blue-500/10"
                    : ""
                } ${past ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  {/* Time column */}
                  <div className="flex flex-col items-center pt-0.5">
                    <div className={`h-2.5 w-2.5 rounded-full ${style.dot} ${current ? "animate-pulse" : ""}`} />
                    <div className="mt-1 w-px flex-1 bg-zinc-700/50" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3
                          className={`font-semibold text-sm ${
                            past ? "line-through text-zinc-500" : style.text
                          }`}
                        >
                          {event.title}
                          {event.isBlocker && (
                            <span className="ml-1.5 text-[10px] font-normal text-zinc-500">
                              FIXED
                            </span>
                          )}
                        </h3>
                        {event.location && (
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {event.location}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-mono text-zinc-400">
                          {formatTime(event.startTime)}
                        </p>
                        <p className="text-[10px] text-zinc-600">
                          {formatDuration(duration)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Voice status toast */}
      {voiceStatus && (
        <div className="fixed bottom-24 left-4 right-20 z-40 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 shadow-lg">
          <p className="text-sm text-zinc-300 line-clamp-3">{voiceStatus}</p>
        </div>
      )}

      {/* Voice Quick-Add FAB */}
      <div className="fixed bottom-24 right-4 z-40">
        <VoiceButton
          onTranscription={handleVoiceQuickAdd}
          size="lg"
        />
      </div>
    </div>
  );
}
