/**
 * llm-client.ts — Unified LLM client supporting multiple providers
 *
 * Supported providers:
 *   - anthropic  → Anthropic API (Claude)
 *   - openai     → OpenAI API (GPT-4o, etc.)
 *   - gemini     → Google Gemini API
 *   - openrouter → OpenRouter (any model via unified API)
 *
 * Configuration via environment variables:
 *   LLM_PROVIDER=anthropic|openai|gemini|openrouter  (default: anthropic)
 *   LLM_MODEL=<model-name>                           (optional, sensible defaults per provider)
 *
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   OPENAI_API_KEY=sk-...
 *   GEMINI_API_KEY=AI...
 *   OPENROUTER_API_KEY=sk-or-...
 *
 * All providers use the OpenAI-compatible chat completions format,
 * except Anthropic which uses its native SDK.
 */

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openrouter';

export interface LLMConfig {
  provider: Provider;
  model: string;
  apiKey: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ---------- Default models per provider ----------

// Ne JAMAIS utiliser un modèle Gemini plus ancien (gemini-2.x, gemini-1.x)
const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-3-flash-preview',
  openrouter: 'anthropic/claude-sonnet-4',
};

// ---------- Provider base URLs ----------

const BASE_URLS: Record<Exclude<Provider, 'anthropic'>, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

// ---------- Resolve config from env ----------

export function resolveConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase().trim() as Provider;

  const keyEnvMap: Record<Provider, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  const apiKey = process.env[keyEnvMap[provider]];
  if (!apiKey) {
    console.error(`✗ ${keyEnvMap[provider]} not set for provider "${provider}"`);
    console.error(`\nConfigure your .env file:\n  LLM_PROVIDER=${provider}\n  ${keyEnvMap[provider]}=your-key-here`);
    process.exit(1);
  }

  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];

  return { provider, model, apiKey };
}

// ---------- Call LLM (unified) ----------

export async function callLLM(
  config: LLMConfig,
  system: string,
  userMessage: string,
  maxTokens: number = 8000,
): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, system, userMessage, maxTokens);
  }
  if (config.provider === 'gemini') {
    return callGeminiNative(config, system, userMessage, maxTokens);
  }
  return callOpenAICompatible(config, system, userMessage, maxTokens);
}

// ---------- Anthropic (native SDK) ----------

async function callAnthropic(
  config: LLMConfig,
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  // Dynamic import to avoid requiring the SDK when using other providers
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Anthropic response');
  return textBlock.text;
}

// ---------- Gemini (native REST API with thinking) ----------

async function callGeminiNative(
  config: LLMConfig,
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  // Gemini 3 → thinkingLevel (low/medium/high) + includeThoughts pour récupérer le résumé
  // Gemini 2.5 → thinkingBudget (nombre de tokens)
  const isGemini3 = config.model.startsWith('gemini-3');
  const thinkingConfig = isGemini3
    ? { thinkingLevel: 'low' as const, includeThoughts: true }
    : { thinkingBudget: 1024 };

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      thinkingConfig,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'no body');
    throw new Error(`gemini API error ${resp.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await resp.json() as any;

  // Log thinking token usage if available
  const usage = data.usageMetadata;
  if (usage?.thoughtsTokenCount) {
    console.log(`  [thinking] ${usage.thoughtsTokenCount} tokens`);
  }

  // Extract text from response parts
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error(`No content in Gemini response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  // Log thought summary if present
  const thoughtParts = parts.filter((p: any) => p.thought && p.text);
  if (thoughtParts.length > 0) {
    const summary = thoughtParts.map((p: any) => p.text).join(' ').slice(0, 200);
    console.log(`  [thoughts] ${summary}...`);
  }

  // Return only non-thought text parts
  const textParts = parts.filter((p: any) => p.text && !p.thought);
  if (textParts.length === 0) {
    // Fallback: return the last part's text
    const lastPart = parts[parts.length - 1];
    if (lastPart?.text) return lastPart.text;
    throw new Error(`No text in Gemini response parts: ${JSON.stringify(parts).slice(0, 300)}`);
  }

  return textParts.map((p: any) => p.text).join('');
}

// ---------- OpenAI-compatible (OpenAI, OpenRouter) ----------

async function callOpenAICompatible(
  config: LLMConfig,
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  const url = BASE_URLS[config.provider as Exclude<Provider, 'anthropic'>];

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userMessage },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  // OpenRouter-specific headers
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://citoyens.ai';
    headers['X-Title'] = 'Citoyens.ai Pipeline';
  }

  const body: Record<string, any> = {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };

  // Gemini: use max_completion_tokens (pas max_tokens)
  if (config.provider === 'gemini') {
    body.max_completion_tokens = maxTokens;
    delete body.max_tokens;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min pour les gros modèles
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'no body');
    throw new Error(`${config.provider} API error ${resp.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await resp.json() as any;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(`No content in ${config.provider} response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return content;
}

// ---------- Retry wrapper ----------

export async function callLLMWithRetry(
  config: LLMConfig,
  system: string,
  userMessage: string,
  maxTokens: number = 8000,
  maxAttempts: number = 3,
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callLLM(config, system, userMessage, maxTokens);
    } catch (err: any) {
      console.error(`  Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        const delay = Math.pow(4, attempt) * 1000; // 4s, 16s
        console.log(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}
