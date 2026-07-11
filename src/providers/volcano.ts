/**
 * Volcengine Ark (火山方舟) provider — OpenAI-compatible endpoint.
 *
 * Uses the Ark "Coding Plan" OpenAI-compatible base URL.
 *
 * doubao-seed models are "thinking" models. Thinking is DISABLED by default
 * here (`thinking: { type: "disabled" }`):
 *   - digest/summary tasks don't need deep reasoning;
 *   - reasoning tokens cost money and eat the completion budget;
 *   - it eliminates the risk of chain-of-thought leaking into reports.
 * If the model rejects the param, the base class retries once without it
 * (and the base class never falls back to `reasoning_content` anyway).
 *
 * Env vars:
 *   ARK_API_KEY   - Ark API key (e.g. "ark-...")
 *   ARK_BASE_URL  - endpoint override (optional)
 *   ARK_MODEL     - model name (default: doubao-seed-2.0-pro)
 *   ARK_THINKING  - "enabled" | "disabled" | "auto" (default: "disabled")
 */

import { OpenAICompatibleProvider } from "./openai-compatible.ts";

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";

export class VolcanoProvider extends OpenAICompatibleProvider {
  readonly name = "volcano";

  constructor(opts?: { apiKey?: string; baseURL?: string; model?: string }) {
    super({
      apiKey: opts?.apiKey ?? process.env["ARK_API_KEY"],
      baseURL: opts?.baseURL ?? process.env["ARK_BASE_URL"] ?? ARK_BASE_URL,
      model: opts?.model ?? process.env["ARK_MODEL"] ?? "doubao-seed-2.0-pro",
      extraBody: {
        thinking: { type: process.env["ARK_THINKING"] ?? "disabled" },
      },
    });
  }
}
