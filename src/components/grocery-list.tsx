"use client";

import { useState, useEffect, useRef } from "react";

interface GroceryItem {
  id: string;
  name: string;
  checked: boolean;
  checkedAt: string | null;
  createdAt: string;
}

export function GroceryList() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchItems() {
    try {
      const res = await fetch("/api/grocery");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
  }, []);

  // Auto-hide checked items after 30 minutes (client-side)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30 * 60 * 1000;
      setItems((prev) =>
        prev.filter(
          (item) =>
            !item.checked ||
            !item.checkedAt ||
            new Date(item.checkedAt).getTime() > cutoff
        )
      );
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const name = newItem.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/grocery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => [data.item, ...prev]);
        setNewItem("");
        inputRef.current?.focus();
      }
    } catch {
      // Error
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(id: string, currentChecked: boolean) {
    const newChecked = !currentChecked;
    // Optimistic update
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              checked: newChecked,
              checkedAt: newChecked ? new Date().toISOString() : null,
            }
          : item
      )
    );
    // Re-sort: unchecked first (newest at top), then checked (most recently checked first)
    setItems((prev) => {
      const unchecked = prev
        .filter((i) => !i.checked)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const checked = prev
        .filter((i) => i.checked)
        .sort((a, b) => {
          const aTime = a.checkedAt ? new Date(a.checkedAt).getTime() : 0;
          const bTime = b.checkedAt ? new Date(b.checkedAt).getTime() : 0;
          return bTime - aTime;
        });
      return [...unchecked, ...checked];
    });

    try {
      await fetch(`/api/grocery/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: newChecked }),
      });
    } catch {
      // Revert on error
      await fetchItems();
    }
  }

  async function deleteItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await fetch(`/api/grocery/${id}`, { method: "DELETE" });
    } catch {
      await fetchItems();
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-zinc-900 animate-pulse" />
        ))}
      </div>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  return (
    <div className="space-y-4">
      {/* Add item form */}
      <form onSubmit={addItem} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Add item..."
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
          autoFocus
          disabled={adding}
        />
        <button
          type="submit"
          disabled={!newItem.trim() || adding}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {/* Items */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
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
              d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
            />
          </svg>
          <p className="text-zinc-500 text-lg font-medium">Your grocery list is empty</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Unchecked items */}
          {unchecked.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-900/50"
            >
              <button
                onClick={() => toggleItem(item.id, item.checked)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 transition-colors hover:border-blue-500"
              />
              <span className="flex-1 text-sm text-white">{item.name}</span>
              <button
                onClick={() => deleteItem(item.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors p-1"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {/* Divider if both sections exist */}
          {unchecked.length > 0 && checked.length > 0 && (
            <div className="border-t border-zinc-800 my-2" />
          )}

          {/* Checked items */}
          {checked.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-900/50"
            >
              <button
                onClick={() => toggleItem(item.id, item.checked)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500 transition-colors"
              >
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </button>
              <span className="flex-1 text-sm text-zinc-500 line-through">{item.name}</span>
              <button
                onClick={() => deleteItem(item.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors p-1"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
