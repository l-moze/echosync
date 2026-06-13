import type { ReactNode } from "react";

export function TabBar({
  tabs,
  activeTab,
  onTabChange
}: {
  tabs: Array<{ id: string; label: ReactNode }>;
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div className="tabBar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={activeTab === tab.id ? "tab active" : "tab"}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
