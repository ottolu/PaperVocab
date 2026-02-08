/**
 * PaperVocab — Utility Functions
 * @module lib/utils
 */

/**
 * Generate a UUID v4
 * @returns {string} UUID string
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if the given text is a valid English word or short phrase (≤3 words)
 * Allows letters, hyphens, and spaces between words.
 * @param {string} text - Text to validate
 * @returns {boolean}
 */
function isEnglishWord(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return false;
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  // Only allow English letters, hyphens, and spaces
  if (!/^[a-zA-Z][a-zA-Z\s-]*[a-zA-Z]$/.test(trimmed) && !/^[a-zA-Z]$/.test(trimmed)) return false;
  // At most 3 words
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return false;
  // Each word should be letters and hyphens only
  for (const word of words) {
    if (!/^[a-zA-Z]([a-zA-Z-]*[a-zA-Z])?$/.test(word)) return false;
  }
  return true;
}

/**
 * Extract the sentence containing the target word from surrounding text.
 * @param {string} text - The larger text context
 * @param {string} word - The target word to find
 * @returns {string} The sentence containing the word, or empty string
 */
function extractSentence(text, word) {
  if (!text || !word) return '';
  // Split text into sentences (by period, question mark, exclamation mark)
  const sentences = text.split(/(?<=[.!?])\s+/);
  const wordLower = word.toLowerCase();
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(wordLower)) {
      return sentence.trim();
    }
  }
  // Fallback: return trimmed text (up to 200 chars)
  return text.trim().substring(0, 200);
}

/**
 * Format an ISO 8601 date string to a friendly display format.
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Formatted date like "2025-07-12"
 */
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

/**
 * Create a debounced version of a function.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
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

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}
