"use client";

import { useState, useEffect } from "react";

export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const isSupported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(isSupported);

    if (isSupported) {
      setPermission(Notification.permission);
      checkSubscription();
    }
  }, []);

  async function checkSubscription() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {
      // Not subscribed
    }
  }

  async function subscribe() {
    setLoading(true);
    try {
      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        setLoading(false);
        return;
      }

      // Get VAPID public key
      const vapidRes = await fetch("/api/push/vapid");
      if (!vapidRes.ok) {
        console.error("Failed to get VAPID key");
        setLoading(false);
        return;
      }
      const { publicKey } = await vapidRes.json();

      // Subscribe via service worker
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });

      // Send subscription to server
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      if (res.ok) {
        setSubscribed(true);
      }
    } catch (err) {
      console.error("Push subscribe error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Unsubscribe from browser
        await sub.unsubscribe();

        // Remove from server
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function testNotification() {
    try {
      await fetch("/api/push/test", { method: "POST" });
    } catch {
      // Failed
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Push Notifications
        </h2>
        <p className="text-sm text-zinc-500">
          Not supported in this browser. Install the PWA from Safari for push
          notification support.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Push Notifications
      </h2>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-300">
            {subscribed ? "Notifications enabled" : "Notifications disabled"}
          </p>
          <p className="text-xs text-zinc-500">
            {permission === "denied"
              ? "Permission denied in browser settings"
              : subscribed
              ? "You'll get morning briefings and schedule updates"
              : "Enable to get morning briefings and reminders"}
          </p>
        </div>
        <button
          onClick={subscribed ? unsubscribe : subscribe}
          disabled={loading || permission === "denied"}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${
            subscribed ? "bg-blue-600" : "bg-zinc-700"
          } ${loading || permission === "denied" ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
              subscribed ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {subscribed && (
        <button
          onClick={testNotification}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Send test notification
        </button>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
