import { Router } from "express";
import type { CortexDb } from "@cortex/db";
import { DEMO_STORE_ID, schema } from "@cortex/db";
import { eq } from "drizzle-orm";
import { studio } from "@cortex/agents";
import {
  CustomAgentCompileRequestSchema,
  CustomAgentGenerateRequestSchema,
  StudioFlowSchema,
} from "@cortex/shared";

export function studioRouter(db: CortexDb): Router {
  const router = Router();
  const storeId = DEMO_STORE_ID;

  // Full template blueprints incl. their flow graph — the canvas renders
  // these directly, so the builder starts from something that actually runs.
  router.get("/custom-agents/templates", (_req, res) => {
    res.json(
      studio.STUDIO_TEMPLATES.map(({ template_id, name, avatar, role, description, prompt, trigger, tools, flow }) => ({
        template_id,
        name,
        avatar,
        role,
        description,
        prompt,
        trigger,
        tools,
        flow,
      })),
    );
  });

  // Every custom agent in the store (DRAFT + ACTIVE) so the Studio sidebar
  // survives a page reload instead of only remembering what it just created.
  router.get("/custom-agents", async (_req, res) => {
    const rows = await db.select().from(schema.agents).where(eq(schema.agents.storeId, storeId));
    res.json(
      rows
        .filter((r) => r.isCustom && r.spec)
        .map((r) => ({ id: r.id, status: r.status, spec: r.spec })),
    );
  });

  // Legacy wire contract (AGENTS.md §5.4): prompt + template_id -> DRAFT spec,
  // persisted so `hire` has something to flip to ACTIVE.
  router.post("/custom-agents/generate", async (req, res) => {
    const parsed = CustomAgentGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });

    const outcome = await studio.compileSpec(parsed.data);
    if (outcome.rejected) {
      return res.status(422).json({ error: "UNSAFE_SPEC_REQUEST", reason: outcome.reason });
    }

    await studio.persistDraft(db, storeId, outcome.spec);
    res.status(201).json(outcome.spec);
  });

  // Builder "Compile" — validates a hand-wired flow and returns the hardened
  // spec without touching the DB, so the canvas can preview what will be saved.
  router.post("/custom-agents/compile", async (req, res) => {
    const parsed = CustomAgentCompileRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });

    const outcome = await studio.compileSpec(parsed.data);
    if (outcome.rejected) return res.status(422).json({ error: "UNSAFE_SPEC_REQUEST", reason: outcome.reason });
    res.json(outcome.spec);
  });

  // Builder "Test run" — executes the flow in dry-run mode against live store
  // data. Stages no decision and sends nothing; returns the step-by-step trace.
  router.post("/custom-agents/test", async (req, res) => {
    const body = req.body ?? {};
    const flow = body.flow ? StudioFlowSchema.parse(body.flow) : undefined;
    if (!flow && !body.agent_id) return res.status(400).json({ error: "NO_FLOW" });

    try {
      const result = await studio.testAgentFlow(db, storeId, {
        agentId: typeof body.agent_id === "string" ? body.agent_id : undefined,
        flow,
        prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        avatar: typeof body.avatar === "string" ? body.avatar : undefined,
        role: typeof body.role === "string" ? body.role : undefined,
        trigger: typeof body.trigger === "string" ? body.trigger : undefined,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === "AGENT_NOT_FOUND") {
        return res.status(404).json({ error: "AGENT_NOT_FOUND" });
      }
      throw err;
    }
  });

  router.get("/custom-agents/:id", async (req, res) => {
    try {
      res.json(await studio.getAgentSpec(db, storeId, req.params.id as string));
    } catch (err) {
      if (err instanceof Error && err.message === "AGENT_NOT_FOUND") {
        return res.status(404).json({ error: "AGENT_NOT_FOUND" });
      }
      throw err;
    }
  });

  // Re-save from the builder: rename, rewire nodes, retune thresholds.
  router.patch("/custom-agents/:id", async (req, res) => {
    const parsed = CustomAgentCompileRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });

    try {
      res.json(await studio.updateDraft(db, storeId, req.params.id as string, parsed.data));
    } catch (err) {
      if (err instanceof Error && err.message === "AGENT_NOT_FOUND") {
        return res.status(404).json({ error: "AGENT_NOT_FOUND" });
      }
      throw err;
    }
  });

  router.post("/custom-agents/:id/hire", async (req, res) => {
    try {
      const spec = await studio.hireAgent(db, storeId, req.params.id as string);
      res.json(spec);
    } catch (err) {
      if (err instanceof Error && err.message === "AGENT_NOT_FOUND") {
        return res.status(404).json({ error: "AGENT_NOT_FOUND" });
      }
      throw err;
    }
  });

  return router;
}
