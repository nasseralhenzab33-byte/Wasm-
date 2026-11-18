'use strict';
// بنية مزودي الذكاء الاصطناعي القابلة للتبديل.
// كل مزود يطبق الواجهة نفسها: chat({ system, messages, tools }) -> { text, toolCalls:[{id,name,input}] }
// و describeImage({ base64, mime, prompt }) -> { text } (للمرحلة الثانية: تحليل الصور).
// اختيار المزود من متغير البيئة AI_PROVIDER = none | anthropic | openai  (openai = أي واجهة متوافقة مع OpenAI).

function noneProvider() {
  return { name: 'none', available: false, async chat() { return null; }, async describeImage() { return null; } };
}

function anthropicProvider({ apiKey, model, baseUrl = 'https://api.anthropic.com' }) {
  const call = async body => {
    const r = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`AI provider error ${r.status}`);
    return r.json();
  };
  return {
    name: 'anthropic', available: true,
    async chat({ system, messages, tools }) {
      const j = await call({ model, max_tokens: 1024, system, messages, tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })) });
      return {
        raw: j.content,
        text: j.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
        toolCalls: j.content.filter(c => c.type === 'tool_use').map(c => ({ id: c.id, name: c.name, input: c.input })),
        stop: j.stop_reason,
      };
    },
    toolResultMessage(calls, results) {
      return [{ role: 'assistant', content: calls.raw }, { role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.output) })) }];
    },
    async describeImage({ base64, mime, prompt }) {
      const j = await call({ model, max_tokens: 700, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }, { type: 'text', text: prompt }] }] });
      return { text: j.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
    },
  };
}

function openaiCompatibleProvider({ apiKey, model, baseUrl = 'https://api.openai.com/v1' }) {
  const call = async body => {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`AI provider error ${r.status}`);
    return r.json();
  };
  return {
    name: 'openai', available: true,
    async chat({ system, messages, tools }) {
      const msgs = [{ role: 'system', content: system }, ...messages];
      const j = await call({ model, messages: msgs, tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) });
      const m = j.choices[0].message;
      return { raw: m, text: m.content || '', toolCalls: (m.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })) };
    },
    toolResultMessage(calls, results) {
      return [calls.raw, ...results.map(r => ({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.output) }))];
    },
    async describeImage({ base64, mime, prompt }) {
      const j = await call({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }] });
      return { text: j.choices[0].message.content };
    },
  };
}

let override = null; // للاختبارات
function getProvider() {
  if (override) return override;
  const p = (process.env.AI_PROVIDER || 'none').toLowerCase();
  if (p === 'anthropic' && process.env.AI_API_KEY) return anthropicProvider({ apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL || 'claude-haiku-5-5', baseUrl: process.env.AI_BASE_URL });
  if (p === 'openai' && process.env.AI_API_KEY) return openaiCompatibleProvider({ apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL || 'gpt-4o-mini', baseUrl: process.env.AI_BASE_URL });
  return noneProvider();
}
function setProvider(p) { override = p; }

module.exports = { getProvider, setProvider, anthropicProvider, openaiCompatibleProvider, noneProvider };
