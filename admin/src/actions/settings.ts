'use server';

export async function getSettingsData() {
  return {
    provider: process.env.LLM_PROVIDER || 'gemini',
    model: process.env.LLM_MODEL || '',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenrouterKey: !!process.env.OPENROUTER_API_KEY,
  };
}

export async function testLlmConnection(): Promise<{
  success: boolean;
  response?: string;
  error?: string;
}> {
  try {
    const provider = process.env.LLM_PROVIDER || 'gemini';
    const model = process.env.LLM_MODEL;

    const keyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    };
    const apiKey = process.env[keyMap[provider] || ''];
    if (!apiKey) return { success: false, error: `Clé API non configurée pour ${provider}` };

    const defaultModels: Record<string, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      gemini: 'gemini-2.5-flash',
      openrouter: 'anthropic/claude-sonnet-4',
    };
    const resolvedModel = model || defaultModels[provider];

    if (provider === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: resolvedModel, max_tokens: 50, messages: [{ role: 'user', content: 'Réponds en un mot: bonjour' }] }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      return { success: true, response: `${resolvedModel} → ${data.content?.[0]?.text || 'OK'}` };
    }

    const baseUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
      openrouter: 'https://openrouter.ai/api/v1',
    };

    const resp = await fetch(`${baseUrls[provider]}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: resolvedModel, max_tokens: 50, messages: [{ role: 'user', content: 'Réponds en un mot: bonjour' }] }),
    });
    if (!resp.ok) throw new Error(`${provider} ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return { success: true, response: `${resolvedModel} → ${data.choices?.[0]?.message?.content || 'OK'}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
