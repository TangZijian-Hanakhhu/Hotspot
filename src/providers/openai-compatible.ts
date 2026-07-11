/**
 * Base class for OpenAI-compatible providers.
 *
 * Shared by OpenAI, GitHub Copilot, OpenRouter, DeepSeek and Volcano providers.
 *
 * Reasoning safety: `reasoning_content` (chain-of-thought from "thinking"
 * models like Volcengine doubao-seed) is NEVER used as output. If the final
 * `content` is empty (e.g. the whole token budget was burned on reasoning),
 * the call fails loudly instead of leaking the thinking process into
 * published reports.
 */

import OpenAI from "openai";
import type { LlmProvider } from "./types.ts";

export abstract class OpenAICompatibleProvider implements LlmProvider {
  abstract readonly name: string;
  protected readonly client: OpenAI;
  protected readonly model: string;
  /** Extra provider-specific body params (e.g. Ark's `thinking`). */
  protected readonly extraBody: Record<string, unknown>;

  constructor(opts: {
    apiKey?: string;
    baseURL?: string;
    model: string;
    extraBody?: Record<string, unknown>;
  }) {
    this.model = opts.model;
    this.extraBody = opts.extraBody ?? {};
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
    });
  }

  private async createCompletion(
    prompt: string,
    maxTokens: number,
    extraBody: Record<string, unknown>,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      ...extraBody,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
  }

  async call(prompt: string, maxTokens: number): Promise<string> {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.createCompletion(prompt, maxTokens, this.extraBody);
    } catch (err) {
      // Some backends/models reject unknown extra params (e.g. `thinking`
      // on models that don't support toggling it). Retry once without them.
      if (Object.keys(this.extraBody).length > 0 && isInvalidParamError(err)) {
        console.error(`[${this.name}] extra params rejected, retrying without them: ${err}`);
        response = await this.createCompletion(prompt, maxTokens, {});
      } else {
        throw err;
      }
    }

    const text = response.choices[0]?.message?.content;
    // Deliberately NO fallback to `reasoning_content`: publishing
    // chain-of-thought is worse than failing this report.
    if (!text) {
      throw new Error(`Empty final content from ${this.name} (reasoning may have consumed the token budget)`);
    }
    return text;
  }
}

/** True for HTTP 400 "invalid parameter" style errors. */
function isInvalidParamError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = String(err).toLowerCase();
  return status === 400 || msg.includes("invalid") || msg.includes("unknown parameter");
}
