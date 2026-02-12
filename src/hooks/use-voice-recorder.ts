"use client";

import { useState, useRef, useCallback } from "react";

export type RecordingState = "idle" | "recording" | "transcribing";

interface UseVoiceRecorderOptions {
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceRecorder({
  onTranscription,
  onError,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Detect supported MIME type (iOS Safari uses mp4, Chrome uses webm)
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/mp4";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/webm";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ""; // Let browser decide
          }
        }
      }

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // Stop timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const actualMime = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: actualMime });

        if (blob.size < 1000) {
          setState("idle");
          onError?.("Recording too short. Try again.");
          return;
        }

        // Transcribe
        setState("transcribing");

        try {
          const ext = actualMime.includes("mp4") ? "mp4" : "webm";
          const formData = new FormData();
          formData.append("audio", blob, `recording.${ext}`);

          const res = await fetch("/api/voice", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Transcription failed");
          }

          const data = await res.json();
          if (data.text?.trim()) {
            onTranscription(data.text.trim());
          } else {
            onError?.("Couldn't understand the audio. Try again.");
          }
        } catch (err) {
          onError?.(
            err instanceof Error ? err.message : "Transcription failed"
          );
        } finally {
          setState("idle");
          setDuration(0);
        }
      };

      recorder.start(1000); // Collect chunks every second
      setState("recording");
      setDuration(0);

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        onError?.("Microphone permission denied. Check your browser settings.");
      } else {
        onError?.("Could not start recording.");
      }
    }
  }, [onTranscription, onError]);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle") {
      startRecording();
    }
    // Do nothing while transcribing
  }, [state, startRecording, stopRecording]);

  return {
    state,
    duration,
    toggleRecording,
    startRecording,
    stopRecording,
  };
}
