/**
 * PaperVocab — LLM API Client
 * Supports OpenAI, Anthropic, and custom (OpenAI-compatible) providers.
 * @module lib/llm
 */

/** Timeout for LLM API calls (ms) */
const LLM_TIMEOUT = 10000;
/** Retry delay (ms) */
const RETRY_DELAY = 2000;
/** Max retries */
const MAX_RETRIES = 1;

/**
 * Build the prompt for word definition query.
 * @param {string} word - The word to look up
 * @param {string} sentence - The original sentence containing the word
 * @returns {string} The prompt string
 */
function buildPrompt(word, sentence) {
  return `你是一个学术英语词汇助手。用户在阅读英文学术论文时遇到一个不认识的单词，请你帮助解释。

单词：${word}
原文句子：${sentence}

请按以下格式返回 JSON：
{
  "lemma": "单词原形",
  "phonetic": "国际音标",
  "definition": "中文释义（聚焦该词在学术语境中的含义，简洁准确，不超过50字）",
  "example": "一个学术场景的英文例句"
}

要求：
1. 释义要贴合学术论文语境，而非日常口语含义
2. 如果该词有多个学术含义，优先给出在原文句子语境中最匹配的含义
3. 例句应来自学术写作场景
4. 严格返回 JSON 格式，不要附加其他内容`;
}

/**
 * Parse LLM response text, extracting JSON with fallback.
 * @param {string} text - Raw response text
 * @returns {Object} Parsed object with lemma, phonetic, definition, example
 */
function parseResponse(text) {
  const defaults = { lemma: '', phonetic: '', definition: '', example: '' };
  if (!text) return defaults;

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    return { ...defaults, ...parsed };
  } catch (e) {
    // Ignore
  }

  // Try extracting JSON block from text (e.g., markdown code block)
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...defaults, ...parsed };
    } catch (e) {
      // Ignore
    }
  }

  // Fallback: use entire text as definition
  return { ...defaults, definition: text.trim() };
}

/**
 * Call OpenAI Chat Completions API.
 * @param {string} prompt - The user prompt
 * @param {Object} settings - User settings
 * @returns {Promise<string>} Response text
 */
async function callOpenAI(prompt, settings) {
  const url = `${settings.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.modelName,
      messages: [
        { role: 'system', content: '你是一个学术英语词汇助手，帮助用户理解学术论文中的英文生词。请严格按 JSON 格式返回结果。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Call Anthropic Messages API.
 * @param {string} prompt - The user prompt
 * @param {Object} settings - User settings
 * @returns {Promise<string>} Response text
 */
async function callAnthropic(prompt, settings) {
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/v1/messages`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.modelName,
      max_tokens: 300,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * Call a custom OpenAI-compatible API.
 * @param {string} prompt - The user prompt
 * @param {Object} settings - User settings
 * @returns {Promise<string>} Response text
 */
async function callCustom(prompt, settings) {
  // Reuse OpenAI format
  return callOpenAI(prompt, settings);
}

/**
 * Fetch with timeout support.
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Main entry: query a word definition via LLM.
 * @param {string} word - The word to look up
 * @param {string} sentence - Original sentence context
 * @param {Object} settings - User settings (llmProvider, apiKey, apiBaseUrl, modelName)
 * @returns {Promise<Object>} Parsed definition object
 */
async function queryWord(word, sentence, settings) {
  const prompt = buildPrompt(word, sentence);
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let responseText = '';
      switch (settings.llmProvider) {
        case 'anthropic':
          responseText = await callAnthropic(prompt, settings);
          break;
        case 'custom':
          responseText = await callCustom(prompt, settings);
          break;
        case 'openai':
        default:
          responseText = await callOpenAI(prompt, settings);
          break;
      }
      return parseResponse(responseText);
    } catch (error) {
      lastError = error;
      console.log(`[PaperVocab] LLM call attempt ${attempt + 1} failed:`, error.message);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  throw lastError;
}
