/**
 * PaperVocab — Service Worker (Background Script)
 * Handles LLM queries, word storage, and message routing.
 *
 * All lib code is inlined here because MV3 service workers do not support
 * importScripts() for extension-local files in all Chrome versions.
 */

// ═══════════════════════════════════════════════════════════════
// lib/utils.js — inlined
// ═══════════════════════════════════════════════════════════════

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isEnglishWord(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  if (!/^[a-zA-Z][a-zA-Z\s-]*[a-zA-Z]$/.test(trimmed) && !/^[a-zA-Z]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return false;
  for (const word of words) {
    if (!/^[a-zA-Z]([a-zA-Z-]*[a-zA-Z])?$/.test(word)) return false;
  }
  return true;
}

function extractSentence(text, word) {
  if (!text || !word) return '';
  const sentences = text.split(/(?<=[.!?])\s+/);
  const wordLower = word.toLowerCase();
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(wordLower)) {
      return sentence.trim();
    }
  }
  return text.trim().substring(0, 200);
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return '';
  }
}

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

// ═══════════════════════════════════════════════════════════════
// lib/storage.js — inlined
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  llmProvider: 'openai',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4o-mini',
  triggerMode: 'icon',
  hotkey: 'Alt',
  reviewBatchSize: 20,
};

async function getAllWords() {
  const result = await chrome.storage.local.get('words');
  return result.words || [];
}

async function getWordByLemma(lemma) {
  const words = await getAllWords();
  const lowerLemma = lemma.toLowerCase();
  return words.find((w) => w.word.toLowerCase() === lowerLemma) || null;
}

async function saveWord(wordEntry) {
  const words = await getAllWords();
  words.push(wordEntry);
  await chrome.storage.local.set({ words });
}

async function updateWord(id, updates) {
  const words = await getAllWords();
  const index = words.findIndex((w) => w.id === id);
  if (index === -1) return;
  words[index] = { ...words[index], ...updates, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ words });
}

async function deleteWord(id) {
  const words = await getAllWords();
  const filtered = words.filter((w) => w.id !== id);
  await chrome.storage.local.set({ words: filtered });
}

async function clearAllWords() {
  await chrome.storage.local.set({ words: [] });
}

async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

async function exportData() {
  const words = await getAllWords();
  return JSON.stringify({
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    words,
  }, null, 2);
}

async function importData(json) {
  const data = JSON.parse(json);
  const importWords = data.words || data;
  if (!Array.isArray(importWords)) {
    throw new Error('Invalid import data format');
  }
  const existingWords = await getAllWords();
  const existingSet = new Set(existingWords.map((w) => w.word.toLowerCase()));
  let count = 0;
  for (const word of importWords) {
    if (word.word && !existingSet.has(word.word.toLowerCase())) {
      existingWords.push(word);
      existingSet.add(word.word.toLowerCase());
      count++;
    }
  }
  await chrome.storage.local.set({ words: existingWords });
  return count;
}

// ═══════════════════════════════════════════════════════════════
// lib/llm.js — inlined
// ═══════════════════════════════════════════════════════════════

const LLM_TIMEOUT = 10000;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 1;

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

function parseResponse(text) {
  const defaults = { lemma: '', phonetic: '', definition: '', example: '' };
  if (!text) return defaults;

  try {
    const parsed = JSON.parse(text);
    return { ...defaults, ...parsed };
  } catch (e) {
    // Ignore
  }

  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...defaults, ...parsed };
    } catch (e) {
      // Ignore
    }
  }

  return { ...defaults, definition: text.trim() };
}

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

async function callCustom(prompt, settings) {
  return callOpenAI(prompt, settings);
}

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

// ═══════════════════════════════════════════════════════════════
// Service Worker — message handling
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('[PaperVocab] Service worker error:', error);
      sendResponse({ error: error.message || 'Unknown error' });
    });
  return true;
});

async function handleMessage(message, sender) {
  console.log('[PaperVocab] Received message:', message.type);

  switch (message.type) {
    case 'QUERY_WORD':
      return handleQueryWord(message);

    case 'SAVE_WORD':
      return handleSaveWord(message);

    case 'GET_SETTINGS':
      return handleGetSettings();

    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { success: true };

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

async function handleQueryWord({ word, sentence, sourceTitle, sourceUrl }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    return { error: 'NO_API_KEY' };
  }

  const context = {
    sentence: sentence || '',
    sourceTitle: sourceTitle || '',
    sourceUrl: sourceUrl || '',
    queriedAt: new Date().toISOString(),
  };

  const existingWord = await getWordByLemma(word);

  if (existingWord) {
    const updatedContexts = [...(existingWord.contexts || []), context];
    await updateWord(existingWord.id, {
      queryCount: (existingWord.queryCount || 0) + 1,
      contexts: updatedContexts,
    });

    return {
      exists: true,
      wordData: {
        ...existingWord,
        queryCount: (existingWord.queryCount || 0) + 1,
        contexts: updatedContexts,
      },
    };
  }

  try {
    const llmResult = await queryWord(word, sentence, settings);
    return {
      exists: false,
      wordData: {
        word: llmResult.lemma || word,
        originalForm: word,
        phonetic: llmResult.phonetic || '',
        definition: llmResult.definition || '',
        example: llmResult.example || '',
        context,
      },
    };
  } catch (error) {
    console.error('[PaperVocab] LLM query failed:', error);
    return { error: error.message || 'LLM query failed' };
  }
}

async function handleSaveWord({ wordData }) {
  const now = new Date().toISOString();
  const entry = {
    id: generateId(),
    word: wordData.word || '',
    originalForm: wordData.originalForm || wordData.word || '',
    phonetic: wordData.phonetic || '',
    definition: wordData.definition || '',
    example: wordData.example || '',
    contexts: wordData.context ? [wordData.context] : [],
    queryCount: 1,
    masteryLevel: 0,
    mastered: false,
    createdAt: now,
    updatedAt: now,
  };

  await saveWord(entry);
  console.log('[PaperVocab] Word saved:', entry.word);
  return { success: true, wordEntry: entry };
}

async function handleGetSettings() {
  const settings = await getSettings();
  return { settings };
}

console.log('[PaperVocab] Service worker started');
