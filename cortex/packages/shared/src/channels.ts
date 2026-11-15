import { z } from "zod";
import { IdentityRoleEnum } from "./enums.js";

// Body for POST /api/channels/simulator/inbound — simulates an inbound
// WhatsApp/Telegram message, voice note, or button tap from the desktop mirror.
export const SimulatorInboundSchema = z.object({
  channel: z.enum(["WHATSAPP", "TELEGRAM"]),
  role: IdentityRoleEnum,
  identity_id: z.string(),
  text: z.string().optional(),
  /** For voice notes: base64-encoded audio data (optional, for demo without real audio) */
  audio_base64: z.string().optional(),
  audio_mime_type: z.string().optional(),
  button: z
    .object({
      decision_id: z.string(),
      action: z.enum(["APPROVE", "REJECT"]),
    })
    .optional(),
});
export type SimulatorInbound = z.infer<typeof SimulatorInboundSchema>;

export const SimulatorInboundResponseSchema = z.object({
  accepted: z.boolean(),
  routed_to: z.string().optional(),
});
export type SimulatorInboundResponse = z.infer<typeof SimulatorInboundResponseSchema>;

export const DemoResetResponseSchema = z.object({
  success: z.literal(true),
  store_id: z.string(),
  reset_at: z.string(),
});
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;
