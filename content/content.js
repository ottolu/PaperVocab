/**
 * PaperVocab — Content Script
 * Handles word selection detection, floating trigger icon, and definition tooltip.
 * All UI is rendered inside a Shadow DOM for style isolation.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────

  const TRIGGER_DISMISS_DELAY = 1500; // Auto-hide trigger icon after 1.5s
  const TOOLTIP_MAX_WIDTH = 360;

  // ─── Shadow DOM Setup ─────────────────────────────────────

  let shadowHost = null;
  let shadow = null;
  let triggerEl = null;
  let tooltipEl = null;
  let triggerTimer = null;
  let currentSelection = null;
  let currentSettings = null;

  function ensureShadowRoot() {
    if (shadowHost) return;
    shadowHost = document.createElement('div');
    shadowHost.id = 'papervocab-root';
    // Host must not clip fixed-position shadow children
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;overflow:visible;pointer-events:none;';
    document.documentElement.appendChild(shadowHost);
    shadow = shadowHost.attachShadow({ mode: 'closed' });
    // Inject styles into shadow DOM
    const style = document.createElement('style');
    style.textContent = getShadowStyles();
    shadow.appendChild(style);
  }

  // ─── Shadow DOM Styles ─────────────────────────────────────

  function getShadowStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .pv-trigger {
        position: fixed;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #2563EB;
        border: 1.5px solid #fff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        pointer-events: auto;
      }

      .pv-trigger:hover {
        transform: scale(1.15);
        box-shadow: 0 3px 12px rgba(37,99,235,0.4);
      }

      .pv-trigger svg {
        width: 12px;
        height: 12px;
      }

      .pv-tooltip {
        position: fixed;
        max-width: ${TOOLTIP_MAX_WIDTH}px;
        min-width: 260px;
        background: #FFFFFF;
        border: 1px solid #E5E7EB;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        color: #1F2937;
        z-index: 2147483647;
        pointer-events: auto;
        overflow: hidden;
        animation: pv-fadeIn 0.18s ease-out;
      }

      @keyframes pv-fadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .pv-tooltip-header {
        padding: 12px 16px 8px;
        border-bottom: 1px solid #F3F4F6;
      }

      .pv-tooltip-word {
        font-size: 18px;
        font-weight: 700;
        color: #1F2937;
        margin-right: 8px;
      }

      .pv-tooltip-phonetic {
        font-size: 13px;
        color: #6B7280;
        font-weight: 400;
      }

      .pv-tooltip-badge {
        display: inline-block;
        background: #EFF6FF;
        color: #2563EB;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 8px;
        vertical-align: middle;
      }

      .pv-tooltip-body {
        padding: 10px 16px;
      }

      .pv-tooltip-definition {
        font-size: 14px;
        line-height: 1.6;
        color: #1F2937;
        margin-bottom: 8px;
      }

      .pv-tooltip-example {
        font-size: 13px;
        line-height: 1.5;
        color: #374151;
        font-style: italic;
        margin-bottom: 8px;
        padding: 6px 10px;
        background: #F9FAFB;
        border-radius: 4px;
        border-left: 3px solid #2563EB;
      }

      .pv-tooltip-context {
        font-size: 12px;
        line-height: 1.5;
        color: #9CA3AF;
        padding: 8px 16px;
        border-top: 1px dashed #E5E7EB;
        word-break: break-word;
      }

      .pv-tooltip-context-label {
        color: #6B7280;
        font-weight: 500;
      }

      .pv-tooltip-footer {
        padding: 8px 16px 12px;
        border-top: 1px solid #F3F4F6;
        display: flex;
        justify-content: flex-end;
      }

      .pv-btn-save {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 16px;
        background: #2563EB;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }

      .pv-btn-save:hover {
        background: #1D4ED8;
      }

      .pv-btn-save.saved {
        background: #10B981;
        cursor: default;
      }

      .pv-btn-save:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .pv-tooltip-loading {
        padding: 32px 16px;
        text-align: center;
        color: #6B7280;
      }

      .pv-spinner {
        display: inline-block;
        width: 24px;
        height: 24px;
        border: 3px solid #E5E7EB;
        border-top-color: #2563EB;
        border-radius: 50%;
        animation: pv-spin 0.7s linear infinite;
        margin-bottom: 8px;
      }

      @keyframes pv-spin {
        to { transform: rotate(360deg); }
      }

      .pv-tooltip-error {
        padding: 16px;
        text-align: center;
        color: #EF4444;
      }

      .pv-btn-retry {
        display: inline-block;
        margin-top: 8px;
        padding: 4px 14px;
        background: #FEF2F2;
        color: #EF4444;
        border: 1px solid #FECACA;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
      }

      .pv-btn-retry:hover {
        background: #FEE2E2;
      }

      .pv-btn-link {
        display: inline-block;
        margin-top: 8px;
        padding: 4px 14px;
        background: #EFF6FF;
        color: #2563EB;
        border: 1px solid #BFDBFE;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        text-decoration: none;
      }

      .pv-btn-link:hover {
        background: #DBEAFE;
      }
    `;
  }

  // ─── Trigger Icon ──────────────────────────────────────────

  function showTrigger(rect) {
    ensureShadowRoot();
    removeTrigger();

    triggerEl = document.createElement('div');
    triggerEl.className = 'pv-trigger';
    triggerEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <text x="4" y="17" font-size="14" font-weight="bold" fill="white" font-family="Arial">PV</text>
      </svg>
    `;

    // Position: right-top of selection
    const left = Math.min(rect.right + 4, window.innerWidth - 28);
    const top = Math.max(rect.top - 26, 4);
    triggerEl.style.left = left + 'px';
    triggerEl.style.top = top + 'px';

    triggerEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTriggerClick();
    });

    triggerEl.addEventListener('mouseenter', () => {
      if (triggerTimer) {
        clearTimeout(triggerTimer);
        triggerTimer = null;
      }
    });

    triggerEl.addEventListener('mouseleave', () => {
      startTriggerDismiss();
    });

    shadow.appendChild(triggerEl);
    startTriggerDismiss();
  }

  function startTriggerDismiss() {
    if (triggerTimer) clearTimeout(triggerTimer);
    triggerTimer = setTimeout(() => {
      removeTrigger();
    }, TRIGGER_DISMISS_DELAY);
  }

  function removeTrigger() {
    if (triggerTimer) {
      clearTimeout(triggerTimer);
      triggerTimer = null;
    }
    if (triggerEl && triggerEl.parentNode) {
      triggerEl.remove();
    }
    triggerEl = null;
  }

  // ─── Tooltip ───────────────────────────────────────────────

  function showTooltip(rect) {
    ensureShadowRoot();
    removeTooltip();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'pv-tooltip';
    tooltipEl.innerHTML = `
      <div class="pv-tooltip-loading">
        <div class="pv-spinner"></div>
        <div>查询中...</div>
      </div>
    `;

    positionTooltip(tooltipEl, rect);
    shadow.appendChild(tooltipEl);
  }

  function positionTooltip(el, rect) {
    // Temporarily make visible to measure
    el.style.visibility = 'hidden';
    el.style.display = 'block';

    // Start below selection
    let left = rect.left;
    let top = rect.bottom + 8;

    // After first render, adjust if needed
    requestAnimationFrame(() => {
      const tooltipRect = el.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal
      if (left + tooltipRect.width > viewportWidth - 8) {
        left = viewportWidth - tooltipRect.width - 8;
      }
      if (left < 8) left = 8;

      // If not enough space below, show above
      if (top + tooltipRect.height > viewportHeight - 8) {
        top = rect.top - tooltipRect.height - 8;
      }
      if (top < 8) top = 8;

      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.visibility = 'visible';
    });

    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.visibility = 'visible';
  }

  function renderTooltipResult(data, exists) {
    if (!tooltipEl) return;

    const wd = data;
    const esc = escapeHtmlLocal;

    let headerExtra = '';
    if (exists) {
      headerExtra = `<span class="pv-tooltip-badge">已收藏 ×${wd.queryCount || 1}</span>`;
    }

    let contextHtml = '';
    if (currentSelection && currentSelection.sentence) {
      contextHtml = `
        <div class="pv-tooltip-context">
          <span class="pv-tooltip-context-label">原文：</span>${esc(currentSelection.sentence)}
        </div>
      `;
    }

    let footerHtml = '';
    if (!exists) {
      footerHtml = `
        <div class="pv-tooltip-footer">
          <button class="pv-btn-save" id="pv-save-btn">⭐ 收藏</button>
        </div>
      `;
    }

    tooltipEl.innerHTML = `
      <div class="pv-tooltip-header">
        <span class="pv-tooltip-word">${esc(wd.word || wd.originalForm || '')}</span>
        <span class="pv-tooltip-phonetic">${esc(wd.phonetic || '')}</span>
        ${headerExtra}
      </div>
      <div class="pv-tooltip-body">
        <div class="pv-tooltip-definition">${esc(wd.definition || '')}</div>
        ${wd.example ? `<div class="pv-tooltip-example">${esc(wd.example)}</div>` : ''}
      </div>
      ${contextHtml}
      ${footerHtml}
    `;

    // Bind save button
    const saveBtn = tooltipEl.querySelector('#pv-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        onSaveWord(wd, saveBtn);
      });
    }

    // Re-position after content change
    if (currentSelection && currentSelection.rect) {
      positionTooltip(tooltipEl, currentSelection.rect);
    }
  }

  function renderTooltipError(errorMsg) {
    if (!tooltipEl) return;

    const isNoKey = errorMsg === 'NO_API_KEY';

    if (isNoKey) {
      tooltipEl.innerHTML = `
        <div class="pv-tooltip-error">
          <div style="font-size:24px; margin-bottom:8px;">🔑</div>
          <div style="color:#1F2937; font-size:14px; margin-bottom:4px;">需要配置 API Key 才能查词</div>
          <button class="pv-btn-link" id="pv-goto-settings">前往设置 →</button>
        </div>
      `;
      const btn = tooltipEl.querySelector('#pv-goto-settings');
      if (btn) {
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
          removeTooltip();
        });
      }
    } else {
      tooltipEl.innerHTML = `
        <div class="pv-tooltip-error">
          <div style="font-size:14px; margin-bottom:4px;">查询失败</div>
          <div style="font-size:12px; color:#6B7280;">${escapeHtmlLocal(errorMsg)}</div>
          <button class="pv-btn-retry" id="pv-retry-btn">重试</button>
        </div>
      `;
      const btn = tooltipEl.querySelector('#pv-retry-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          if (currentSelection) {
            tooltipEl.innerHTML = `
              <div class="pv-tooltip-loading">
                <div class="pv-spinner"></div>
                <div>查询中...</div>
              </div>
            `;
            doQuery();
          }
        });
      }
    }
  }

  function removeTooltip() {
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.remove();
    }
    tooltipEl = null;
  }

  // ─── Query Logic ───────────────────────────────────────────

  function onTriggerClick() {
    removeTrigger();
    if (!currentSelection) return;

    showTooltip(currentSelection.rect);
    doQuery();
  }

  function doQuery() {
    if (!currentSelection) return;

    chrome.runtime.sendMessage(
      {
        type: 'QUERY_WORD',
        word: currentSelection.word,
        sentence: currentSelection.sentence,
        sourceTitle: document.title,
        sourceUrl: window.location.href,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.log('[PaperVocab] Message error:', chrome.runtime.lastError.message);
          renderTooltipError('连接失败，请重试');
          return;
        }
        if (!response) {
          renderTooltipError('无响应，请重试');
          return;
        }
        if (response.error) {
          renderTooltipError(response.error);
          return;
        }
        renderTooltipResult(response.wordData, response.exists);
      }
    );
  }

  function onSaveWord(wordData, btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';

    chrome.runtime.sendMessage(
      {
        type: 'SAVE_WORD',
        wordData: {
          word: wordData.word || wordData.originalForm,
          originalForm: currentSelection ? currentSelection.word : wordData.word,
          phonetic: wordData.phonetic || '',
          definition: wordData.definition || '',
          example: wordData.example || '',
          context: wordData.context || {
            sentence: currentSelection ? currentSelection.sentence : '',
            sourceTitle: document.title,
            sourceUrl: window.location.href,
            queriedAt: new Date().toISOString(),
          },
        },
      },
      (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          btn.disabled = false;
          btn.textContent = '⭐ 收藏';
          console.log('[PaperVocab] Save error:', chrome.runtime.lastError?.message || response?.error);
          return;
        }
        btn.textContent = '已收藏 ✓';
        btn.classList.add('saved');
      }
    );
  }

  // ─── Selection Detection ───────────────────────────────────

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

    const text = sel.toString().trim();
    if (!text || !isEnglishWordLocal(text)) return null;

    const range = sel.getRangeAt(0);
    const liveRect = range.getBoundingClientRect();
    if (liveRect.width === 0 && liveRect.height === 0) return null;

    // Clone the rect so it doesn't go stale
    const rect = {
      top: liveRect.top,
      right: liveRect.right,
      bottom: liveRect.bottom,
      left: liveRect.left,
      width: liveRect.width,
      height: liveRect.height,
    };

    // Extract sentence context from surrounding text
    let sentence = '';
    try {
      const container = range.startContainer.parentElement;
      if (container) {
        const fullText = container.textContent || '';
        sentence = extractSentenceLocal(fullText, text);
      }
    } catch (e) {
      // Ignore extraction errors
    }

    return { word: text, rect, sentence };
  }

  // ─── Event Listeners ──────────────────────────────────────

  document.addEventListener('mouseup', (e) => {
    // Ignore clicks on our own UI elements (the host itself)
    if (shadowHost && (shadowHost === e.target || shadowHost.contains(e.target))) return;

    // Small delay to let selection finalize
    setTimeout(() => {
      const info = getSelectionInfo();
      console.log('[PaperVocab] mouseup — selection info:', info ? info.word : null);
      if (info) {
        // Close old tooltip/trigger before showing new
        removeTooltip();
        removeTrigger();
        currentSelection = info;
        // Check trigger mode from cached settings
        if (currentSettings && currentSettings.triggerMode === 'auto') {
          showTooltip(info.rect);
          doQuery();
        } else {
          showTrigger(info.rect);
        }
      }
    }, 10);
  });

  // Close tooltip on outside click (mousedown on non-PV area)
  document.addEventListener('mousedown', (e) => {
    if (!tooltipEl && !triggerEl) return;
    // If click is inside our shadow host, ignore
    if (shadowHost && (shadowHost === e.target || shadowHost.contains(e.target))) return;

    // Check if click target is inside the shadow DOM (for closed shadow we can't,
    // but the host check above covers it).
    // Delay slightly so it doesn't race with the mouseup handler
    setTimeout(() => {
      // Only close if there's no new selection being made
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        removeTooltip();
        removeTrigger();
      }
    }, 50);
  });

  // Close tooltip on Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      removeTooltip();
      removeTrigger();
    }
  });

  // Handle scroll — reposition tooltip
  window.addEventListener('scroll', () => {
    // On scroll, close tooltip (simplest approach for fixed positioning)
    if (tooltipEl) {
      removeTooltip();
    }
    if (triggerEl) {
      removeTrigger();
    }
  }, { passive: true });

  // ─── Load Settings ─────────────────────────────────────────

  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('[PaperVocab] Settings load error (expected on initial load):', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.settings) {
          currentSettings = response.settings;
          console.log('[PaperVocab] Settings loaded, triggerMode:', currentSettings.triggerMode);
        }
      });
    } catch (e) {
      console.log('[PaperVocab] Settings load exception:', e.message);
    }
  }

  loadSettings();
  // Reload settings when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      currentSettings = { ...currentSettings, ...changes.settings.newValue };
    }
  });

  // ─── Local Utility Functions ───────────────────────────────
  // (Duplicated from lib/utils.js since content scripts can't importScripts)

  function isEnglishWordLocal(text) {
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

  function extractSentenceLocal(text, word) {
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

  function escapeHtmlLocal(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  console.log('[PaperVocab] Content script loaded');
})();
