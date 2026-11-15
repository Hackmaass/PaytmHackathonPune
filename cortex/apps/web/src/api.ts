import type {
  WorkforceResponse,
  ActivityEvent,
  MetricsResponse,
  KhataResponse,
  ReconciliationResponse,
  ComplianceCalendarResponse,
  PurchaseOrdersResponse,
  StaffResponse,
  DecisionActionResponse,
  DecisionRejectResponse,
  CustomAgentSpec,
  StudioTemplate,
  ActionSource,
  AttendanceAction,
} from "@cortex/shared";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3200";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = new Error((json as { error?: string })?.error ?? `POST ${path} failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = new Error((json as { error?: string })?.error ?? `PATCH ${path} failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}
export const api = {
  base: BASE,
  getWorkforce: () => get<WorkforceResponse>("/api/cortex/workforce"),
  getStreamSnapshot: () => get<ActivityEvent[]>("/api/cortex/stream"),
  getMetrics: () => get<MetricsResponse>("/api/cortex/metrics"),
  runAgent: (agentId: string) => post<{ run_id: string; agent_id: string; status: string }>(`/api/cortex/agents/${agentId}/run`, {}),
  decideDecision: (decisionId: string, action: "APPROVE" | "REJECT", source: ActionSource) =>
    post<DecisionActionResponse | DecisionRejectResponse>(`/api/cortex/decisions/${decisionId}/action`, { action, source }),

  getKhata: () => get<KhataResponse>("/api/cortex/khata"),
  addKhataEntry: (body: { customer_id: string; type: "CREDIT" | "PAYMENT"; amount: number; note?: string }) =>
    post<{ success: true }>("/api/cortex/khata", body),
  getReconciliation: (date?: string) => get<ReconciliationResponse>(`/api/cortex/accounts/reconciliation${date ? `?date=${date}` : ""}`),
  getComplianceCalendar: () => get<ComplianceCalendarResponse>("/api/cortex/compliance/calendar"),

  getPurchaseOrders: () => get<PurchaseOrdersResponse>("/api/cortex/procurement/purchase-orders"),

  getStaff: () => get<StaffResponse>("/api/cortex/staff"),
  markAttendance: (workerId: string, type: AttendanceAction) =>
    post<{ success: true }>("/api/cortex/staff/attendance", { worker_id: workerId, type, source: "DESKTOP" }),

  getStudioTemplates: () => get<StudioTemplate[]>("/api/cortex/custom-agents/templates"),
  listCustomAgents: () => get<Array<{ id: string; status: string; spec: CustomAgentSpec }>>("/api/cortex/custom-agents"),
  getCustomAgent: (agentId: string) => get<CustomAgentSpec>(`/api/cortex/custom-agents/${agentId}`),
  compileCustomAgent: (body: {
    prompt?: string;
    template_id?: string | null;
    flow?: unknown;
    name?: string;
    avatar?: string;
    role?: string;
    trigger?: string;
  }) => post<CustomAgentSpec>("/api/cortex/custom-agents/compile", body),
  generateCustomAgent: (prompt: string, templateId: string | null) =>
    post<CustomAgentSpec>("/api/cortex/custom-agents/generate", { prompt, template_id: templateId }),
  updateCustomAgent: (agentId: string, body: unknown) =>
    patch<CustomAgentSpec>(`/api/cortex/custom-agents/${agentId}`, body),
  hireCustomAgent: (agentId: string) => post<CustomAgentSpec>(`/api/cortex/custom-agents/${agentId}/hire`, {}),
  testCustomAgent: (body: unknown) =>
    post<{
      success: boolean;
      agent_id: string;
      steps: Array<{ node_id: string; kind: string; label: string; status: string; detail: string; row_count?: number }>;
      messages: Array<{ to_label: string; to: string; text: string }>;
      needs_approval: boolean;
      headline: string;
    }>("/api/cortex/custom-agents/test", body),

  sendSimulatorInbound: (body: {
    channel: "WHATSAPP" | "TELEGRAM";
    role: "OWNER" | "STAFF" | "SUPPLIER" | "CUSTOMER";
    identity_id: string;
    text?: string;
    button?: { decision_id: string; action: "APPROVE" | "REJECT" };
  }) => post<{ accepted: boolean; routed_to?: string }>("/api/channels/simulator/inbound", body),

  resetDemo: () => post<{ success: true; store_id: string; reset_at: string }>("/api/demo/reset", {}),

  getWhatsAppStatus: () => get<{ status: "DISCONNECTED" | "QR_PENDING" | "CONNECTED"; qr?: string }>("/api/channels/whatsapp/status"),

  getVoiceStatus: () =>
    get<{
      provider: "SARVAM" | "OS_TTS";
      configured: boolean;
      default_language: string;
      default_speaker: string;
      speakers: Array<{ id: string; gender: string; persona: string }>;
    }>("/api/channels/voice/status"),

  testVoiceSpeak: (text: string) =>
    post<{ success: boolean; provider: string; spoken_text: string }>("/api/channels/voice/speak", { text }),

  sendVoiceQuery: (text: string) =>
    post<{ success: boolean; query: string; routed_to?: string; reply_text?: string }>("/api/cortex/voice-query", { text }),
};
