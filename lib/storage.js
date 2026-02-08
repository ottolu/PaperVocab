/**
 * PaperVocab — Storage Layer
 * Wraps chrome.storage.local (words) and chrome.storage.sync (settings).
 * @module lib/storage
 */

/** Default user settings */
const DEFAULT_SETTINGS = {
  llmProvider: 'openai',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4o-mini',
  triggerMode: 'icon',
  hotkey: 'Alt',
  reviewBatchSize: 20,
};

// ─── Word CRUD ───────────────────────────────────────────────

/**
 * Get all words from local storage.
 * @returns {Promise<Array>} Array of WordEntry objects
 */
async function getAllWords() {
  const result = await chrome.storage.local.get('words');
  return result.words || [];
}

/**
 * Find a word by its lemma (for deduplication).
 * @param {string} lemma - The lemmatized word
 * @returns {Promise<Object|null>} WordEntry or null
 */
async function getWordByLemma(lemma) {
  const words = await getAllWords();
  const lowerLemma = lemma.toLowerCase();
  return words.find((w) => w.word.toLowerCase() === lowerLemma) || null;
}

/**
 * Save a new word entry to storage.
 * @param {Object} wordEntry - The WordEntry object to save
 * @returns {Promise<void>}
 */
async function saveWord(wordEntry) {
  const words = await getAllWords();
  words.push(wordEntry);
  await chrome.storage.local.set({ words });
}

/**
 * Update an existing word entry by ID.
 * @param {string} id - WordEntry ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
async function updateWord(id, updates) {
  const words = await getAllWords();
  const index = words.findIndex((w) => w.id === id);
  if (index === -1) return;
  words[index] = { ...words[index], ...updates, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ words });
}

/**
 * Delete a word entry by ID.
 * @param {string} id - WordEntry ID
 * @returns {Promise<void>}
 */
async function deleteWord(id) {
  const words = await getAllWords();
  const filtered = words.filter((w) => w.id !== id);
  await chrome.storage.local.set({ words: filtered });
}

/**
 * Clear all words from storage.
 * @returns {Promise<void>}
 */
async function clearAllWords() {
  await chrome.storage.local.set({ words: [] });
}

// ─── Settings CRUD ───────────────────────────────────────────

/**
 * Get user settings, merged with defaults.
 * @returns {Promise<Object>} Full settings object
 */
async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

/**
 * Save user settings to sync storage.
 * @param {Object} settings - Settings object to save
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

// ─── Data Export / Import ────────────────────────────────────

/**
 * Export all words as a JSON string.
 * @returns {Promise<string>} JSON string of all words
 */
async function exportData() {
  const words = await getAllWords();
  return JSON.stringify({
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    words,
  }, null, 2);
}

/**
 * Import words from a JSON string. Deduplicates by word (lemma) field.
 * @param {string} json - JSON string to import
 * @returns {Promise<number>} Number of new words imported
 */
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
