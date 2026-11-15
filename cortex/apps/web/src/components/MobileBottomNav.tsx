export type MobileTab = "counter" | "reconcile" | "khata" | "staff" | "soundbox";

export function MobileBottomNav(props: {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  pendingCount: number;
  soundboxSpeaking: boolean;
}) {
  return (
    <nav className="mobile-bottom-nav">
      <button
        className={`mobile-nav-btn ${props.activeTab === "counter" ? "active" : ""}`}
        onClick={() => props.onChangeTab("counter")}
      >
        <span className="nav-icon">🏪</span>
        <span className="nav-text">Counter</span>
      </button>

      <button
        className={`mobile-nav-btn ${props.activeTab === "reconcile" ? "active" : ""}`}
        onClick={() => props.onChangeTab("reconcile")}
      >
        <span className="nav-icon">⚡</span>
        <span className="nav-text">Pay Check</span>
      </button>

      <button
        className={`mobile-nav-btn ${props.activeTab === "khata" ? "active" : ""}`}
        onClick={() => props.onChangeTab("khata")}
      >
        <span className="nav-icon">📒</span>
        <span className="nav-text">Khata</span>
      </button>

      <button
        className={`mobile-nav-btn ${props.activeTab === "staff" ? "active" : ""}`}
        onClick={() => props.onChangeTab("staff")}
      >
        <span className="nav-icon">👷</span>
        <span className="nav-text">Staff</span>
      </button>

      <button
        className={`mobile-nav-btn ${props.activeTab === "soundbox" ? "active" : ""}`}
        onClick={() => props.onChangeTab("soundbox")}
      >
        <span className={`nav-icon ${props.soundboxSpeaking ? "speaker-active" : ""}`}>🔊</span>
        <span className="nav-text">Soundbox</span>
        {props.pendingCount > 0 && <span className="nav-badge">{props.pendingCount}</span>}
      </button>
    </nav>
  );
}
