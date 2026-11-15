import { useState, useEffect } from "react";
import { NavRail, type ViewId } from "./components/NavRail.js";
import { StoreHeader } from "./components/StoreHeader.js";
import { SoundboxWidget } from "./components/SoundboxWidget.js";
import { MobileBottomNav, type MobileTab } from "./components/MobileBottomNav.js";
import { MobileCounterView } from "./components/MobileCounterView.js";
import { MobilePayCheckView } from "./components/MobilePayCheck.js";
import { MobileAppHeader } from "./components/MobileAppHeader.js";
import { MobileVoiceSheet } from "./components/MobileVoiceMic.js";
import { soundboxAudio, type SoundboxAudioState } from "./services/soundboxAudio.js";
import { useActivityStream } from "./hooks/useActivityStream.js";
import { usePendingDecisions } from "./hooks/usePendingDecisions.js";
import { usePolling } from "./hooks/usePolling.js";
import { api } from "./api.js";
import { CommandCenterView } from "./views/CommandCenterView.js";
import { KhataAccountsView } from "./views/KhataAccountsView.js";
import { StockPurchaseView } from "./views/StockPurchaseView.js";
import { StaffView } from "./views/StaffView.js";
import { StudioView } from "./views/StudioView.js";
import { ChannelsView } from "./views/ChannelsView.js";

const MOBILE_BREAKPOINT = 768;

export default function App() {
  const [view, setView] = useState<ViewId>("command");
  const [mobileTab, setMobileTab] = useState<MobileTab>("counter");
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false,
  );
  const [showSoundboxModal, setShowSoundboxModal] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [audioState, setAudioState] = useState<SoundboxAudioState>(soundboxAudio.getState());

  const { events, live, refresh: refreshStream } = useActivityStream();
  const pending = usePendingDecisions(events);
  const workforce = usePolling(api.getWorkforce, 5000);
  const metrics = usePolling(api.getMetrics, 5000, isMobile);

  // Resize listener to detect mobile vs desktop
  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Subscribe to audio state
  useEffect(() => {
    return soundboxAudio.subscribe(setAudioState);
  }, []);

  // Auto-trigger soundbox voice on incoming SSE / Polled events
  useEffect(() => {
    if (events.length > 0) {
      const latest = events[events.length - 1];
      if (latest) {
        soundboxAudio.handleActivityEvent(latest);
      }
    }
  }, [events]);

  const badgeCounts: Partial<Record<ViewId, number>> = {
    khata: pending.filter((p) => p.decision_kind === "KHATA_REMINDER_BATCH").length,
    stock: pending.filter((p) => p.decision_kind === "PURCHASE_ORDER").length,
    staff: pending.filter((p) => p.decision_kind === "PAYROLL_PAYOUT").length,
  };

  async function handleDecision(decisionId: string, action: "APPROVE" | "REJECT") {
    try {
      return await api.decideDecision(decisionId, action, "DESKTOP");
    } finally {
      void refreshStream();
      void workforce.refresh();
    }
  }

  async function handleTriggerAgent(agentId: string) {
    try {
      await api.runAgent(agentId);
      void refreshStream();
      void workforce.refresh();
    } catch (err) {
      console.error("[agent:trigger] failed:", err);
    }
  }

  const refreshAll = () => {
    void refreshStream();
    void workforce.refresh();
    void metrics.refresh();
  };

  return (
    <div className={`app-shell ${isMobile ? "is-mobile-shell" : ""}`}>
      {/* Desktop Left Nav Rail */}
      {!isMobile && (
        <NavRail active={view} onChange={setView} badgeCounts={badgeCounts} />
      )}

      {isMobile ? (
        <>
          <MobileAppHeader
            store={workforce.data?.store}
            live={live}
            onOpenSoundbox={() => setMobileTab("soundbox")}
            onOpenVoice={() => setVoiceOpen(true)}
          />

          <main className="m-scroll">
            {mobileTab === "counter" && (
              <MobileCounterView
                workforce={workforce.data}
                metrics={metrics.data}
                metricsStale={metrics.error !== undefined}
                events={events}
                pending={pending}
                onDecision={handleDecision}
                onTriggerAgent={handleTriggerAgent}
                onOpenPayCheck={() => setMobileTab("paycheck")}
                onOpenVoice={() => setVoiceOpen(true)}
                onRefresh={refreshAll}
              />
            )}
            {mobileTab === "paycheck" && (
              <MobilePayCheckView events={events} onRefresh={refreshAll} />
            )}
            {mobileTab === "khata" && <KhataAccountsView />}
            {mobileTab === "staff" && <StaffView pending={pending} onDecision={handleDecision} />}
            {mobileTab === "soundbox" && (
              <div className="m-stack">
                <div className="m-section__head">
                  <h1 className="m-page-title">Soundbox</h1>
                  <span className="m-section__hint">live controller</span>
                </div>
                <SoundboxWidget />
              </div>
            )}
          </main>

          <MobileBottomNav
            activeTab={mobileTab}
            onChangeTab={setMobileTab}
            pendingCount={pending.length}
            soundboxSpeaking={audioState.isPlaying}
          />

          <MobileVoiceSheet
            open={voiceOpen}
            onClose={() => setVoiceOpen(false)}
            onActivityRefreshed={refreshAll}
          />
        </>
      ) : (
        <div className="app-main">
          {/* Top Store Header */}
          <StoreHeader
            store={workforce.data?.store}
            live={live}
            onOpenSoundbox={() => setShowSoundboxModal(true)}
          />

          {view === "command" && (
            <CommandCenterView
              events={events}
              pending={pending}
              workforce={workforce}
              onDecision={handleDecision}
              onGoToStudio={() => setView("studio")}
            />
          )}
          {view === "khata" && <KhataAccountsView />}
          {view === "stock" && <StockPurchaseView onDecision={handleDecision} />}
          {view === "staff" && <StaffView pending={pending} onDecision={handleDecision} />}
          {view === "studio" && <StudioView onHired={() => void workforce.refresh()} />}
          {view === "channels" && (
            <ChannelsView store={workforce.data?.store} onReset={() => void refreshStream()} />
          )}

          {/* Desktop Soundbox Modal */}
          {showSoundboxModal && (
            <div className="modal-backdrop" onClick={() => setShowSoundboxModal(false)}>
              <div className="modal-dialog-soundbox" onClick={(e) => e.stopPropagation()}>
                <SoundboxWidget onClose={() => setShowSoundboxModal(false)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
