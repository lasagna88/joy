"use client";

import { useState, useEffect } from "react";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  deadline: string | null;
  location: string | null;
  contactName: string | null;
  estimatedMinutes: number | null;
  createdAt: string;
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-zinc-500/20 text-zinc-400 border-zinc-500/40",
};

const categoryLabels: Record<string, string> = {
  door_knocking: "Door Knocking",
  appointment: "Appointment",
  follow_up: "Follow-up",
  admin: "Admin",
  goal_work: "Goal Work",
  personal: "Personal",
  other: "Other",
};

const categoryIcons: Record<string, string> = {
  door_knocking: "🚪",
  appointment: "📅",
  follow_up: "📞",
  admin: "📋",
  goal_work: "🎯",
  personal: "👤",
  other: "📌",
};

function timeAgo(iso: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function InboxView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks?status=inbox");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      // Show empty state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTasks();
  }, []);

  async function completeTask(taskId: string) {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      // Silently fail, task stays in list
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-zinc-900 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inbox</h1>
        {tasks.length > 0 && (
          <span className="rounded-full bg-blue-600/20 px-2.5 py-0.5 text-sm font-medium text-blue-400">
            {tasks.length}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="h-16 w-16 text-zinc-700 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
          <p className="text-zinc-500 text-lg font-medium">Inbox empty</p>
          <p className="text-zinc-600 text-sm mt-1">
            Tell Papwa about tasks in Chat — they'll appear here
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-start gap-3">
                {/* Complete button */}
                <button
                  onClick={() => completeTask(task.id)}
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 text-zinc-600 transition-colors hover:border-green-500 hover:text-green-500"
                >
                  <svg
                    className="h-3.5 w-3.5 opacity-0 hover:opacity-100"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={3}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">
                      {task.title}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        priorityColors[task.priority] || priorityColors.medium
                      }`}
                    >
                      {task.priority}
                    </span>
                  </div>

                  {task.description && (
                    <p className="text-sm text-zinc-400 mt-1 line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                    <span>
                      {categoryIcons[task.category]}{" "}
                      {categoryLabels[task.category] || task.category}
                    </span>
                    {task.contactName && <span>{task.contactName}</span>}
                    {task.estimatedMinutes && (
                      <span>{task.estimatedMinutes}min</span>
                    )}
                    {task.location && (
                      <span className="truncate max-w-[120px]">
                        {task.location}
                      </span>
                    )}
                    <span>{timeAgo(task.createdAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
