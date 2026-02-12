"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { VoiceButton } from "./voice-button";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ToolAction {
  tool: string;
  input: Record<string, unknown>;
  result: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function ToolActionBadge({ action }: { action: ToolAction }) {
  const parsed = JSON.parse(action.result);
  const labels: Record<string, string> = {
    create_task: "Created task",
    update_task: "Updated task",
    list_tasks: "Checked tasks",
    list_events_today: "Checked schedule",
    list_events: "Checked schedule",
    create_calendar_event: "Scheduled event",
    delete_calendar_event: "Removed event",
    clear_day_schedule: "Cleared schedule",
    get_preferences: "Checked preferences",
    list_goals: "Checked goals",
    create_goal: "Created goal",
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400">
      <svg
        className="h-3.5 w-3.5 text-blue-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
        />
      </svg>
      <span>
        {labels[action.tool] || action.tool}
        {action.tool === "create_task" && parsed.task?.title && (
          <span className="text-zinc-300">: {parsed.task.title}</span>
        )}
      </span>
    </div>
  );
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<ToolAction[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleVoiceTranscription = useCallback((text: string) => {
    setInput((prev) => {
      const combined = prev ? `${prev} ${text}` : text;
      return combined;
    });
    // Focus the input after transcription
    inputRef.current?.focus();
  }, []);

  // Load the most recent conversation on mount
  useEffect(() => {
    async function loadConversation() {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;
        const data = await res.json();
        if (data.conversations?.length > 0) {
          const convId = data.conversations[0].id;
          setConversationId(convId);
          const msgRes = await fetch(
            `/api/conversations/${convId}/messages`
          );
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            setMessages(msgData.messages || []);
          }
        }
      } catch {
        // Start fresh
      }
    }
    loadConversation();
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingActions]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setPendingActions([]);

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Chat request failed");
      }

      setConversationId(data.conversationId);

      if (data.toolActions?.length > 0) {
        setPendingActions(data.toolActions);
      }

      if (data.message) {
        const assistantMsg: ChatMessage = {
          id: `resp-${Date.now()}`,
          role: "assistant",
          content: data.message,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Sorry, I couldn't process that: ${detail}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col -mx-4 -mt-4">
      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-bold">Chat with Joy</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-3">J</div>
            <p className="text-zinc-400 text-sm max-w-xs">
              Tell me about your tasks, appointments, or anything you need to
              get done. I'll organize it for you.
            </p>
            <div className="mt-6 space-y-2 text-xs text-zinc-500">
              <p>&quot;New appointment with John at 123 Main St, Thursday 2pm&quot;</p>
              <p>&quot;I need to follow up with Sarah about the install&quot;</p>
              <p>&quot;What&apos;s in my inbox?&quot;</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <p
                className={`text-[10px] mt-1 ${
                  msg.role === "user" ? "text-blue-200" : "text-zinc-500"
                }`}
              >
                {formatTime(msg.createdAt)}
              </p>
            </div>
          </div>
        ))}

        {/* Tool action badges */}
        {pendingActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingActions.map((action, i) => (
              <ToolActionBadge key={i} action={action} />
            ))}
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl px-4 py-3">
              <div className="flex gap-1.5">
                <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
                <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
                <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="flex items-end gap-2">
          <VoiceButton onTranscription={handleVoiceTranscription} size="sm" />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell Joy what you need..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
