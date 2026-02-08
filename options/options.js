/**
 * PaperVocab — Options Page Script
 * Handles LLM configuration, trigger settings, data import/export.
 */

(function () {
  'use strict';

  // ─── Default Settings ──────────────────────────────────────

  const DEFAULT_SETTINGS = {
    llmProvider: 'openai',
    apiKey: '',
    apiBaseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o-mini',
    triggerMode: 'icon',
    hotkey: 'Alt',
    reviewBatchSize: 20,
  };

  const PROVIDER_DEFAULTS = {
    openai: { apiBaseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini' },
    anthropic: { apiBaseUrl: 'https://api.anthropic.com', modelName: 'claude-3-haiku-20240307' },
    custom: { apiBaseUrl: '', modelName: '' },
  };

  // ─── DOM References ────────────────────────────────────────

  const $form = document.getElementById('settings-form');
  const $provider = document.getElementById('llm-provider');
  const $apiKey = document.getElementById('api-key');
  const $apiBaseUrl = document.getElementById('api-base-url');
  const $modelName = document.getElementById('model-name');
  const $hotkeyGroup = document.getElementById('hotkey-group');
  const $hotkeyInput = document.getElementById('hotkey-input');
  const $reviewBatchSize = document.getElementById('review-batch-size');
  const $btnExport = document.getElementById('btn-export');
  const $btnImport = document.getElementById('btn-import');
  const $btnClear = document.getElementById('btn-clear');
  const $dataInfo = document.getElementById('data-info');
  const $toast = document.getElementById('toast');

  // ─── Initialization ────────────────────────────────────────

  async function init() {
    await loadAndFillSettings();
    bindEvents();
    await showWordCount();
  }

  async function loadAndFillSettings() {
    try {
      const result = await chrome.storage.sync.get('settings');
      const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };

      $provider.value = settings.llmProvider;
      $apiKey.value = settings.apiKey;
      $apiBaseUrl.value = settings.apiBaseUrl;
      $modelName.value = settings.modelName;
      $reviewBatchSize.value = settings.reviewBatchSize;

      // Trigger mode
      const triggerRadio = document.querySelector(`input[name="trigger-mode"][value="${settings.triggerMode}"]`);
      if (triggerRadio) triggerRadio.checked = true;
      updateHotkeyVisibility(settings.triggerMode);

      $hotkeyInput.value = settings.hotkey || 'Alt';
    } catch (e) {
      console.error('[PaperVocab] Failed to load settings:', e);
    }
  }

  async function showWordCount() {
    try {
      const result = await chrome.storage.local.get('words');
      const count = (result.words || []).length;
      $dataInfo.textContent = `当前生词本：${count} 个单词`;
    } catch (e) {
      // Ignore
    }
  }

  // ─── Event Binding ─────────────────────────────────────────

  function bindEvents() {
    // Provider change
    $provider.addEventListener('change', () => {
      const provider = $provider.value;
      const defaults = PROVIDER_DEFAULTS[provider];
      if (defaults) {
        $apiBaseUrl.value = defaults.apiBaseUrl;
        $modelName.value = defaults.modelName;
        $apiBaseUrl.placeholder = defaults.apiBaseUrl || '请输入 API Base URL';
        $modelName.placeholder = defaults.modelName || '请输入模型名称';
      }
    });

    // Trigger mode change
    document.querySelectorAll('input[name="trigger-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        updateHotkeyVisibility(radio.value);
      });
    });

    // Hotkey capture
    $hotkeyInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      $hotkeyInput.value = e.key;
    });

    // Save form
    $form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveSettingsFromForm();
    });

    // Export
    $btnExport.addEventListener('click', exportWords);

    // Import
    $btnImport.addEventListener('change', importWords);

    // Clear
    $btnClear.addEventListener('click', clearWords);
  }

  function updateHotkeyVisibility(mode) {
    $hotkeyGroup.style.display = mode === 'hotkey' ? 'block' : 'none';
  }

  // ─── Save Settings ─────────────────────────────────────────

  async function saveSettingsFromForm() {
    const apiKey = $apiKey.value.trim();
    if (!apiKey) {
      showToast('请输入 API Key', 'error');
      $apiKey.focus();
      return;
    }

    const triggerMode = document.querySelector('input[name="trigger-mode"]:checked')?.value || 'icon';

    const settings = {
      llmProvider: $provider.value,
      apiKey: apiKey,
      apiBaseUrl: $apiBaseUrl.value.trim() || PROVIDER_DEFAULTS[$provider.value]?.apiBaseUrl || '',
      modelName: $modelName.value.trim() || PROVIDER_DEFAULTS[$provider.value]?.modelName || '',
      triggerMode: triggerMode,
      hotkey: $hotkeyInput.value || 'Alt',
      reviewBatchSize: parseInt($reviewBatchSize.value) || 20,
    };

    try {
      await chrome.storage.sync.set({ settings });
      showToast('设置保存成功！现在可以开始划词查询了', 'success');
    } catch (e) {
      console.error('[PaperVocab] Failed to save settings:', e);
      showToast('保存失败: ' + e.message, 'error');
    }
  }

  // ─── Data Export ───────────────────────────────────────────

  async function exportWords() {
    try {
      const result = await chrome.storage.local.get('words');
      const words = result.words || [];
      const exportObj = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        words: words,
      };
      const json = JSON.stringify(exportObj, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `papervocab-export-${formatDate(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`已导出 ${words.length} 个单词`, 'success');
    } catch (e) {
      console.error('[PaperVocab] Export failed:', e);
      showToast('导出失败: ' + e.message, 'error');
    }
  }

  // ─── Data Import ───────────────────────────────────────────

  async function importWords(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const importWords = data.words || data;

      if (!Array.isArray(importWords)) {
        throw new Error('无效的数据格式');
      }

      // Merge with existing words (dedup by word)
      const existing = await chrome.storage.local.get('words');
      const existingWords = existing.words || [];
      const existingSet = new Set(existingWords.map((w) => w.word.toLowerCase()));

      let addedCount = 0;
      for (const word of importWords) {
        if (word.word && !existingSet.has(word.word.toLowerCase())) {
          existingWords.push(word);
          existingSet.add(word.word.toLowerCase());
          addedCount++;
        }
      }

      await chrome.storage.local.set({ words: existingWords });
      showToast(`导入成功！新增 ${addedCount} 个单词（${importWords.length - addedCount} 个重复已跳过）`, 'success');
      await showWordCount();
    } catch (e) {
      console.error('[PaperVocab] Import failed:', e);
      showToast('导入失败: ' + e.message, 'error');
    }

    // Reset file input
    e.target.value = '';
  }

  // ─── Clear Data ────────────────────────────────────────────

  async function clearWords() {
    const confirmed = confirm('⚠️ 确定要清空所有生词吗？\n\n此操作不可撤销！建议先导出备份。');
    if (!confirmed) return;

    const doubleConfirm = confirm('再次确认：清空后所有生词数据将永久删除，是否继续？');
    if (!doubleConfirm) return;

    try {
      await chrome.storage.local.set({ words: [] });
      showToast('生词本已清空', 'info');
      await showWordCount();
    } catch (e) {
      console.error('[PaperVocab] Clear failed:', e);
      showToast('清空失败: ' + e.message, 'error');
    }
  }

  // ─── Toast ─────────────────────────────────────────────────

  let toastTimer = null;

  function showToast(message, type = 'success') {
    if (toastTimer) clearTimeout(toastTimer);
    $toast.textContent = message;
    $toast.className = `pv-toast ${type}`;
    $toast.style.display = 'block';
    toastTimer = setTimeout(() => {
      $toast.style.display = 'none';
    }, 3000);
  }

  // ─── Utility ───────────────────────────────────────────────

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // ─── Start ─────────────────────────────────────────────────

  init();
  console.log('[PaperVocab] Options page loaded');
})();
