import type { ComponentType } from "react";
import { IconBolt, IconBook, IconCounter, IconSpeaker, IconUsers } from "./icons.js";

export type MobileTab = "counter" | "paycheck" | "khata" | "staff" | "soundbox";

const TABS: Array<{ id: MobileTab; label: string; Icon: ComponentType<{ size?: number }> }> = [
  { id: "counter", label: "Counter", Icon: IconCounter },
  { id: "paycheck", label: "Pay check", Icon: IconBolt },
  { id: "khata", label: "Khata", Icon: IconBook },
  { id: "staff", label: "Staff", Icon: IconUsers },
  { id: "soundbox", label: "Soundbox", Icon: IconSpeaker },
];

export function MobileBottomNav(props: {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  pendingCount: number;
  soundboxSpeaking: boolean;
}) {
  return (
    <nav className="m-nav" aria-label="Primary">
      {TABS.map(({ id, label, Icon }) => {
        const active = props.activeTab === id;
        const showBadge = id === "counter" && props.pendingCount > 0;
        return (
          <button
            key={id}
            type="button"
            className={`m-nav__btn ${active ? "is-active" : ""}`}
            onClick={() => props.onChangeTab(id)}
            aria-current={active ? "page" : undefined}
          >
            <span className="m-nav__icon">
              <Icon size={22} />
              {id === "soundbox" && props.soundboxSpeaking && <span className="m-nav__pulse" aria-hidden="true" />}
              {showBadge && (
                <span className="m-nav__badge">
                  {props.pendingCount > 9 ? "9+" : props.pendingCount}
                  <span className="sr-only"> pending approvals</span>
                </span>
              )}
            </span>
            <span className="m-nav__label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
