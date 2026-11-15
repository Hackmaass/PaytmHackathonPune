import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  CustomAgentSpec,
  StudioFlow,
  StudioFlowNode,
  StudioNodeKind,
  StudioTemplate,
} from "@cortex/shared";
import { STUDIO_NODE_META, STUDIO_NODE_KINDS, STUDIO_TRIGGERS } from "@cortex/shared";
import { usePolling } from "../hooks/usePolling.js";
import { api } from "../api.js";

interface NodeData {
  kind: StudioNodeKind;
  label: string;
  config: StudioFlowNode["config"];
  [key: string]: unknown;
}

type StudioNode = Node<NodeData>;

const NODE_COLORS: Record<StudioNodeKind, string> = {
  TRIGGER: "#8b5cf6",
  READ: "#00baf2",
  FILTER: "#0ea5e9",
  GUARDRAIL: "#f59e0b",
  DRAFT: "#25d366",
  APPROVAL: "#002970",
  NOTIFY: "#64748b",
};

function StudioNodeComponent({ data }: { data: NodeData }) {
  const meta = STUDIO_NODE_META[data.kind];
  return (
    <div
      style={{
        background: "#fff",
        border: `2px solid ${NODE_COLORS[data.kind]}`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 150,
        boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: NODE_COLORS[data.kind], textTransform: "uppercase" }}>
        {meta.icon} {meta.title}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{data.label}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = { studio: StudioNodeComponent };

function flowToRf(flow: StudioFlow): { nodes: StudioNode[]; edges: Edge[] } {
  return {
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: "studio",
      position: n.position ?? { x: 0, y: 0 },
      data: { kind: n.kind, label: n.label, config: n.config ?? {} },
    })),
    edges: flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function rfToFlow(nodes: StudioNode[], edges: Edge[]): StudioFlow {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      config: n.data.config ?? {},
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

let nodeCounter = 1;
function newNode(kind: StudioNodeKind, position = { x: 80, y: 80 }): StudioNode {
  const meta = STUDIO_NODE_META[kind];
  const id = `${kind.toLowerCase()}-${nodeCounter++}`;
  return {
    id,
    type: "studio",
    position,
    data: { kind, label: meta.title, config: kind === "TRIGGER" ? { trigger: "CRON_HEARTBEAT_DAILY_0900" } : {} },
  };
}

export function StudioView(props: { onHired: () => void }) {
  const templates = usePolling(api.getStudioTemplates, 60_000);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("CRON_HEARTBEAT_DAILY_0900");
  const [compiling, setCompiling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [spec, setSpec] = useState<CustomAgentSpec | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [trace, setTrace] = useState<{
    success: boolean;
    steps: Array<{ node_id: string; kind: string; label: string; status: string; detail: string; row_count?: number }>;
    messages: Array<{ to_label: string; to: string; text: string }>;
    needs_approval: boolean;
    headline: string;
  } | null>(null);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges]);

  function addNode(kind: StudioNodeKind) {
    const n = newNode(kind, { x: 120 + nodes.length * 40, y: 120 + (nodes.length % 4) * 90 });
    setNodes((ns) => [...ns, n]);
    setSelectedId(n.id);
  }

  function loadTemplate(t: StudioTemplate) {
    const rf = flowToRf(t.flow);
    setNodes(rf.nodes);
    setEdges(rf.edges);
    setPrompt(t.prompt);
    setName(t.name);
    setTrigger(t.trigger);
    setSpec(undefined);
    setTrace(null);
  }

  function updateSelected(patch: Partial<NodeData>) {
    if (!selectedId) return;
    setNodes((ns) =>
      ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  function updateConfig(key: string, value: unknown) {
    if (!selected) return;
    updateSelected({ config: { ...selected.data.config, [key]: value } });
  }

  async function compile(): Promise<void> {
    setCompiling(true);
    setError(undefined);
    try {
      const flow = rfToFlow(nodes, edges);
      const s = await api.generateCustomAgent(prompt.trim() || "Custom agent built on the Studio canvas.", null);
      await api.updateCustomAgent(s.agent_id, {
        prompt: prompt.trim() || "Custom agent built on the Studio canvas.",
        template_id: null,
        flow,
        name: name.trim() || s.name,
        avatar: s.avatar,
        role: s.role,
        trigger,
      });
      const refreshed = await api.getCustomAgent(s.agent_id);
      setSpec(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  }

  async function testRun(): Promise<void> {
    setTesting(true);
    setError(undefined);
    try {
      const flow = rfToFlow(nodes, edges);
      const r = await api.testCustomAgent({
        flow,
        prompt: prompt.trim() || "Custom agent built on the Studio canvas.",
        name: name.trim() || undefined,
        trigger,
      });
      setTrace(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test run failed");
    } finally {
      setTesting(false);
    }
  }

  async function hire(): Promise<void> {
    if (!spec) return;
    try {
      // Persist first if this spec came from compile (already persisted? compile doesn't persist).
      // Generate path persists; compile doesn't. So persist via generate? Use updateDraft? Simpler:
      // re-generate to persist a DRAFT, then hire. But spec already has id. Use update endpoint to save flow.
      await api.updateCustomAgent(spec.agent_id, {
        prompt: prompt.trim() || spec.description,
        template_id: null,
        flow: spec.flow,
        name: spec.name,
        avatar: spec.avatar,
        role: spec.role,
        trigger: spec.trigger,
      });
      const hired = await api.hireCustomAgent(spec.agent_id);
      setSpec(hired);
      setToast(`${hired.name} joined the team!`);
      props.onHired();
      setTimeout(() => setToast(undefined), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hire failed");
    }
  }

  // Persist draft on compile so hire has a row. compile endpoint doesn't persist,
  // so call generate to persist when we have a flow but no saved spec.
  useEffect(() => {
    // no-op placeholder
  }, []);

  return (
    <div className="view">
      <div className="view-header">
        <h2>✨ Paytm Agent Studio: "Hire a Teammate"</h2>
      </div>
      {toast && <div className="pill green">{toast}</div>}

      <div className="studio-split" style={{ gridTemplateColumns: "200px 1fr 300px" }}>
        {/* Palette */}
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card-title">Blocks</div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {STUDIO_NODE_KINDS.map((k) => {
              const meta = STUDIO_NODE_META[k];
              return (
                <button
                  key={k}
                  className="btn secondary"
                  style={{ justifyContent: "flex-start", borderColor: NODE_COLORS[k] }}
                  onClick={() => addNode(k)}
                >
                  {meta.icon} {meta.title}
                </button>
              );
            })}
          </div>
          <div className="card-title" style={{ marginTop: 8 }}>Templates</div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {templates.data?.map((t) => (
              <button key={t.template_id} className="btn secondary" style={{ justifyContent: "flex-start" }} onClick={() => loadTemplate(t)}>
                {t.avatar} {t.name}
              </button>
            ))}
          </div>
        </section>

        {/* Canvas */}
        <section className="card" style={{ padding: 0, minHeight: 480 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </section>

        {/* Inspector */}
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card-title">Inspector</div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <label>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Name</div>
              <input className="studio-textarea" style={{ minHeight: 0, height: 32 }} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Trigger</div>
              <select style={{ width: "100%", height: 32 }} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                {STUDIO_TRIGGERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Prompt</div>
              <textarea className="studio-textarea" style={{ minHeight: 60 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>

            {selected && (
              <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {STUDIO_NODE_META[selected.data.kind].icon} {selected.data.kind}
                </div>
                <label>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Label</div>
                  <input
                    className="studio-textarea"
                    style={{ minHeight: 0, height: 32 }}
                    value={selected.data.label}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                  />
                </label>
                {selected.data.kind === "READ" && (
                  <label style={{ marginTop: 8, display: "block" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Dataset</div>
                    <select
                      style={{ width: "100%", height: 32 }}
                      value={selected.data.config.dataset ?? ""}
                      onChange={(e) => updateConfig("dataset", e.target.value)}
                    >
                      <option value="">— choose —</option>
                      {["KHATA", "INVENTORY", "SALES", "STAFF", "ATTENDANCE", "COMPLIANCE", "SETTLEMENTS", "CUSTOMERS"].map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selected.data.kind === "TRIGGER" && (
                  <label style={{ marginTop: 8, display: "block" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Trigger</div>
                    <select
                      style={{ width: "100%", height: 32 }}
                      value={selected.data.config.trigger ?? trigger}
                      onChange={(e) => updateConfig("trigger", e.target.value)}
                    >
                      {STUDIO_TRIGGERS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selected.data.kind === "FILTER" && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Filters (field op value)</div>
                    <textarea
                      className="studio-textarea"
                      style={{ minHeight: 60 }}
                      value={JSON.stringify(selected.data.config.filters ?? [], null, 2)}
                      onChange={(e) => {
                        try {
                          updateConfig("filters", JSON.parse(e.target.value));
                        } catch {
                          /* ignore until valid */
                        }
                      }}
                    />
                  </div>
                )}
                {selected.data.kind === "GUARDRAIL" && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <label>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Quiet hours</div>
                      <input
                        className="studio-textarea"
                        style={{ minHeight: 0, height: 32 }}
                        value={selected.data.config.quietHours ?? "20:00-08:00"}
                        onChange={(e) => updateConfig("quietHours", e.target.value)}
                      />
                    </label>
                    <label>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Max messages</div>
                      <input
                        type="number"
                        className="studio-textarea"
                        style={{ minHeight: 0, height: 32 }}
                        value={selected.data.config.maxMessages ?? 20}
                        onChange={(e) => updateConfig("maxMessages", Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Min rows</div>
                      <input
                        type="number"
                        className="studio-textarea"
                        style={{ minHeight: 0, height: 32 }}
                        value={selected.data.config.minRows ?? 1}
                        onChange={(e) => updateConfig("minRows", Number(e.target.value))}
                      />
                    </label>
                  </div>
                )}
                {selected.data.kind === "DRAFT" && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Message template (use {"{{field}}"})</div>
                    <textarea
                      className="studio-textarea"
                      style={{ minHeight: 90 }}
                      value={selected.data.config.text ?? ""}
                      onChange={(e) => updateConfig("text", e.target.value)}
                    />
                  </div>
                )}
                {selected.data.kind === "NOTIFY" && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Notify message</div>
                    <textarea
                      className="studio-textarea"
                      style={{ minHeight: 60 }}
                      value={selected.data.config.message ?? ""}
                      onChange={(e) => updateConfig("message", e.target.value)}
                    />
                  </div>
                )}
                <button
                  className="btn danger"
                  style={{ marginTop: 10, width: "100%" }}
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
                    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
                    setSelectedId(null);
                  }}
                >
                  Delete block
                </button>
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="btn" onClick={() => void compile()} disabled={compiling || nodes.length === 0}>
                {compiling ? "Compiling…" : "✨ Compile"}
              </button>
              <button className="btn secondary" onClick={() => void testRun()} disabled={testing || nodes.length === 0}>
                {testing ? "Running…" : "▶ Test run"}
              </button>
              {spec && spec.status === "DRAFT" && (
                <button className="btn" onClick={() => void hire()}>
                  ✅ Hire teammate
                </button>
              )}
              {spec && (
                <div className="compiled-spec" style={{ marginTop: 6 }}>
                  <strong>
                    {spec.avatar} {spec.name}
                  </strong>
                  <div style={{ fontSize: 12 }}>Status: {spec.status}</div>
                  <div style={{ fontSize: 12 }}>Tools: {spec.tools.join(", ")}</div>
                </div>
              )}
              {error && <div className="banner error">{error}</div>}
            </div>
          </div>
        </section>
      </div>

      {trace && (
        <section className="card" style={{ marginTop: 12 }}>
          <div className="card-title">Test run trace</div>
          <div style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{trace.headline}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {trace.steps.map((s) => (
                <div key={s.node_id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: s.status === "BLOCKED" ? "var(--danger-red)" : s.status === "EMPTY" ? "var(--warning-amber)" : "var(--status-green)",
                      width: 70,
                    }}
                  >
                    {s.status}
                  </span>
                  <span style={{ fontWeight: 600, width: 140 }}>{s.label}</span>
                  <span style={{ color: "var(--text-muted)" }}>{s.detail}</span>
                </div>
              ))}
            </div>
            {trace.messages.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Drafted messages ({trace.messages.length})</div>
                {trace.messages.slice(0, 5).map((m, i) => (
                  <div key={i} style={{ fontSize: 12, padding: 6, background: "var(--slate-bg)", borderRadius: 6, marginBottom: 4 }}>
                    <strong>{m.to_label}</strong> · {m.to}
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{m.text}</div>
                  </div>
                ))}
                {trace.messages.length > 5 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>…and {trace.messages.length - 5} more</div>}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}