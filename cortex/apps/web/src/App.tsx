import { useState, useEffect } from "react";
import { NavRail, type ViewId } from "./components/NavRail.js";
import { StoreHeader } from "./components/StoreHeader.js";
import { SoundboxWidget } from "./components/SoundboxWidget.js";
import { MobileBottomNav, type MobileTab } from "./components/MobileBottomNav.js";
import { MobileCounterView } from "./components/MobileCounterView.js";
import { MobileVoiceMic } from "./components/MobileVoiceMic.js";
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

export default function App() {
  const [view, setView] = useState<ViewId>("command");
  const [mobileTab, setMobileTab] = useState<MobileTab>("counter");
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false,
  );
  const [showSoundboxModal, setShowSoundboxModal] = useState(false);
  const [audioState, setAudioState] = useState<SoundboxAudioState>(soundboxAudio.getState());

  const { events, live, refresh: refreshStream } = useActivityStream();
  const pending = usePendingDecisions(events);
  const workforce = usePolling(api.getWorkforce, 5000);

  // Resize listener to detect mobile vs desktop
  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
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

  return (
    <div className={`app-shell ${isMobile ? "is-mobile-shell" : ""}`}>
      {/* Desktop Left Nav Rail */}
      {!isMobile && (
        <NavRail active={view} onChange={setView} badgeCounts={badgeCounts} />
      )}

      <div className="app-main">
        {/* Top Store Header */}
        <StoreHeader
          store={workforce.data?.store}
          live={live}
          onOpenSoundbox={() => {
            if (isMobile) {
              setMobileTab("soundbox");
            } else {
              setShowSoundboxModal(true);
            }
          }}
        />

        {/* Mobile View Router */}
        {isMobile ? (
          <div className="mobile-view-content">
            {mobileTab === "counter" && (
              <MobileCounterView
                workforce={workforce.data}
                events={events}
                pending={pending}
                onDecision={handleDecision}
                onTriggerAgent={handleTriggerAgent}
                onRefresh={() => {
                  void refreshStream();
                  void workforce.refresh();
                }}
              />
            )}
            {mobileTab === "reconcile" && (
              <div className="mobile-tab-pane">
                <div className="view-header">
                  <h2>⚡ Instant Counter Payment Check</h2>
                </div>
                <MobileCounterView
                  workforce={workforce.data}
                  events={events}
                  pending={pending}
                  onDecision={handleDecision}
                  onTriggerAgent={handleTriggerAgent}
                  onRefresh={() => {
                    void refreshStream();
                    void workforce.refresh();
                  }}
                />
              </div>
            )}
            {mobileTab === "khata" && <KhataAccountsView />}
            {mobileTab === "staff" && <StaffView pending={pending} onDecision={handleDecision} />}
            {mobileTab === "soundbox" && (
              <div className="mobile-tab-pane">
                <div className="view-header">
                  <h2>🔊 Paytm Soundbox Live Controller</h2>
                </div>
                <SoundboxWidget />
              </div>
            )}
          </div>
        ) : (
          /* Desktop Views */
          <>
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
            {view === "channels" && <ChannelsView store={workforce.data?.store} onReset={() => void refreshStream()} />}
          </>
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileBottomNav
          activeTab={mobileTab}
          onChangeTab={setMobileTab}
          pendingCount={pending.length}
          soundboxSpeaking={audioState.isPlaying}
        />
      )}

      {/* Floating Hindi Voice Mic for Merchant */}
      <MobileVoiceMic
        onActivityRefreshed={() => {
          void refreshStream();
          void workforce.refresh();
        }}
      />

      {/* Desktop Soundbox Modal */}
      {!isMobile && showSoundboxModal && (
        <div className="modal-backdrop" onClick={() => setShowSoundboxModal(false)}>
          <div className="modal-dialog-soundbox" onClick={(e) => e.stopPropagation()}>
            <SoundboxWidget onClose={() => setShowSoundboxModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
