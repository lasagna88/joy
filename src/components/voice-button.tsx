"use client";

import { useVoiceRecorder, type RecordingState } from "@/hooks/use-voice-recorder";

interface VoiceButtonProps {
  onTranscription: (text: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function formatSeconds(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function VoiceButton({
  onTranscription,
  size = "md",
  className = "",
}: VoiceButtonProps) {
  const { state, duration, toggleRecording } = useVoiceRecorder({
    onTranscription,
    onError: (err) => console.error("[voice]", err),
  });

  const sizeClasses = {
    sm: "h-9 w-9",
    md: "h-10 w-10",
    lg: "h-14 w-14",
  };

  const iconSizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Duration display when recording */}
      {state === "recording" && (
        <span className="text-xs font-mono text-red-400 animate-pulse">
          {formatSeconds(duration)}
        </span>
      )}

      {/* Transcribing indicator */}
      {state === "transcribing" && (
        <span className="text-xs text-blue-400 animate-pulse">
          Transcribing...
        </span>
      )}

      {/* Button */}
      <button
        onClick={toggleRecording}
        disabled={state === "transcribing"}
        className={`flex flex-shrink-0 items-center justify-center rounded-xl transition-all ${
          sizeClasses[size]
        } ${
          state === "recording"
            ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30"
            : state === "transcribing"
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600 active:scale-95"
        }`}
        title={
          state === "recording"
            ? "Stop recording"
            : state === "transcribing"
            ? "Transcribing..."
            : "Start voice input"
        }
      >
        {state === "recording" ? (
          // Stop icon
          <svg
            className={iconSizes[size]}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : state === "transcribing" ? (
          // Spinner
          <svg
            className={`${iconSizes[size]} animate-spin`}
            fill="none"
            viewBox="0 0 24 24"
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
        ) : (
          // Mic icon
          <svg
            className={iconSizes[size]}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
