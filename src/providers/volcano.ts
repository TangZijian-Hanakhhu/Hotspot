/**
 * Volcengine Ark (火山方舟) provider — OpenAI-compatible endpoint.
 *
 * Uses the Ark "Coding Plan" OpenAI-compatible base URL. doubao-seed models
 * are "thinking" models that may return their output in `reasoning_content`;
 * the shared OpenAICompatibleProvider already falls back to that field.
 *
 * Env vars:
 *   ARK_API_KEY   - Ark API key (e.g. "ark-...")
 *   ARK_BASE_URL  - endpoint override (optional)
 *   ARK_MODEL     - model name (default: doubao-seed-2.0-pro)
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
    });
  }
}
