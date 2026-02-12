"use client";

import { useState } from "react";
import { InboxView } from "./inbox-view";
import { GroceryList } from "./grocery-list";

const tabs = ["Inbox", "Grocery"] as const;
type Tab = (typeof tabs)[number];

export function ListsView() {
  const [activeTab, setActiveTab] = useState<Tab>("Inbox");

  return (
    <div className="space-y-4">
      {/* Segmented control */}
      <div className="flex rounded-lg bg-zinc-900 p-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "Inbox" ? <InboxView /> : <GroceryList />}
    </div>
  );
}
