"use client";

import { useState, useEffect } from "react";

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  color?: string;
  metadata?: { category?: string };
}

interface DayData {
  date: Date;
  dateStr: string;
  dayName: string;
  dayNum: number;
  isToday: boolean;
  events: CalendarEvent[];
}

const categoryDots: Record<string, string> = {
  door_knocking: "bg-green-400",
  appointment: "bg-blue-400",
  follow_up: "bg-amber-400",
  admin: "bg-purple-400",
  goal_work: "bg-cyan-400",
  personal: "bg-pink-400",
  lunch: "bg-yellow-400",
  travel: "bg-slate-400",
  buffer: "bg-zinc-600",
  other: "bg-zinc-400",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
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

function getWeekDays(offset: number): DayData[] {
  const today = new Date();
  const startOfWeek = new Date(today);
  // Monday start
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff + offset * 7);

  const days: DayData[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    days.push({
      date: d,
      dateStr: d.toISOString().split("T")[0],
      dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: d.getDate(),
      isToday,
      events: [],
    });
  }
  return days;
}

export function WeekView() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [days, setDays] = useState<DayData[]>(() => getWeekDays(0));
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const newDays = getWeekDays(weekOffset);
    setDays(newDays);

    // Auto-expand today
    const today = newDays.find((d) => d.isToday);
    if (today && weekOffset === 0) {
      setExpandedDay(today.dateStr);
    }

    // Fetch events for the week
    async function fetchWeekEvents() {
      setLoading(true);
      try {
        const start = newDays[0].date.toISOString();
        const endDate = new Date(newDays[6].date);
        endDate.setDate(endDate.getDate() + 1);
        const end = endDate.toISOString();

        const res = await fetch(`/api/events?start=${start}&end=${end}`);
        if (res.ok) {
          const data = await res.json();
          const events: CalendarEvent[] = data.events || [];

          // Group events by day
          const updated = newDays.map((day) => ({
            ...day,
            events: events.filter((e: CalendarEvent) => {
              const eventDate = new Date(e.startTime)
                .toISOString()
                .split("T")[0];
              return eventDate === day.dateStr;
            }),
          }));
          setDays(updated);
        }
      } catch {
        // Keep empty
      } finally {
        setLoading(false);
      }
    }

    fetchWeekEvents();
  }, [weekOffset]);

  const weekLabel = (() => {
    if (days.length === 0) return "";
    const start = days[0].date;
    const end = days[6].date;
    const startMonth = start.toLocaleDateString("en-US", { month: "short" });
    const endMonth = end.toLocaleDateString("en-US", { month: "short" });
    if (startMonth === endMonth) {
      return `${startMonth} ${start.getDate()} - ${end.getDate()}`;
    }
    return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
  })();

  return (
    <div className="space-y-4">
      {/* Header with week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="rounded-lg bg-zinc-800 p-2 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold">{weekLabel}</h1>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Back to this week
            </button>
          )}
        </div>
        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          className="rounded-lg bg-zinc-800 p-2 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Day pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((day) => {
          const isExpanded = expandedDay === day.dateStr;
          const hasEvents = day.events.length > 0;
          return (
            <button
              key={day.dateStr}
              onClick={() =>
                setExpandedDay(isExpanded ? null : day.dateStr)
              }
              className={`flex flex-col items-center rounded-xl px-3 py-2 min-w-[3rem] transition-all ${
                isExpanded
                  ? "bg-blue-600 text-white"
                  : day.isToday
                  ? "bg-zinc-800 text-white ring-1 ring-blue-500/50"
                  : "bg-zinc-900 text-zinc-400"
              }`}
            >
              <span className="text-[10px] uppercase">{day.dayName}</span>
              <span className="text-lg font-bold">{day.dayNum}</span>
              {hasEvents && (
                <div className="flex gap-0.5 mt-0.5">
                  {day.events.length <= 3 ? (
                    day.events.map((_, i) => (
                      <div key={i} className="h-1 w-1 rounded-full bg-current opacity-60" />
                    ))
                  ) : (
                    <span className="text-[9px] opacity-60">{day.events.length}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded day view */}
      {expandedDay && (
        <div className="space-y-2">
          {(() => {
            const day = days.find((d) => d.dateStr === expandedDay);
            if (!day) return null;

            if (loading) {
              return (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-zinc-900 animate-pulse" />
                  ))}
                </div>
              );
            }

            if (day.events.length === 0) {
              return (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 py-8 text-center">
                  <p className="text-zinc-500 text-sm">No events scheduled</p>
                  <p className="text-zinc-600 text-xs mt-1">
                    {day.isToday
                      ? 'Go to Today and tap "Plan my day"'
                      : "Events will appear after planning"}
                  </p>
                </div>
              );
            }

            // Calculate day stats
            const totalMinutes = day.events.reduce(
              (acc, e) => acc + getDurationMinutes(e.startTime, e.endTime),
              0
            );

            return (
              <>
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs text-zinc-500">
                    {day.date.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {day.events.length} blocks &middot;{" "}
                    {formatDuration(totalMinutes)}
                  </p>
                </div>
                {day.events.map((event) => {
                  const category =
                    (event.metadata?.category as string) || "other";
                  const dot = categoryDots[category] || categoryDots.other;
                  const duration = getDurationMinutes(
                    event.startTime,
                    event.endTime
                  );
                  return (
                    <div
                      key={event.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5"
                    >
                      <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">
                          {event.title}
                        </p>
                        {event.location && (
                          <p className="text-[11px] text-zinc-500 truncate">
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
                  );
                })}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
