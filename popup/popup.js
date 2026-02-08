/**
 * PaperVocab — Popup Script
 * Manages vocabulary list, search/sort, card review, and statistics.
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────

  let words = [];
  let currentTab = 'vocabulary';
  let sortBy = 'queryCount';
  let searchQuery = '';
  let expandedWordId = null;
  let editingWordId = null;

  // Review state
  let reviewState = 'idle'; // idle | reviewing | completed
  let reviewCards = [];
  let currentIndex = 0;
  let isFlipped = false;
  let reviewResults = { know: 0, fuzzy: 0, unknown: 0 };
  let reviewBatchSize = 20;

  // Dialog state
  let pendingDeleteId = null;

  // ─── DOM References ────────────────────────────────────────

  const $searchInput = document.getElementById('search-input');
  const $wordList = document.getElementById('word-list');
  const $emptyState = document.getElementById('empty-state');
  const $footerStats = document.getElementById('footer-stats');
  const $statTotal = document.getElementById('stat-total');
  const $statWeek = document.getElementById('stat-week');
  const $statMastered = document.getElementById('stat-mastered');

  // Review
  const $reviewIdle = document.getElementById('review-idle');
  const $reviewCardView = document.getElementById('review-card-view');
  const $reviewCompleted = document.getElementById('review-completed');
  const $reviewCount = document.getElementById('review-count');
  const $reviewProgress = document.getElementById('review-progress');
  const $reviewCard = document.getElementById('review-card');
  const $cardWord = document.getElementById('card-word');
  const $cardCount = document.getElementById('card-count');
  const $cardBackWord = document.getElementById('card-back-word');
  const $cardBackPhonetic = document.getElementById('card-back-phonetic');
  const $cardBackDef = document.getElementById('card-back-definition');
  const $cardBackExample = document.getElementById('card-back-example');

  // Dialog
  const $dialogOverlay = document.getElementById('dialog-overlay');
  const $dialogTitle = document.getElementById('dialog-title');
  const $dialogBody = document.getElementById('dialog-body');
  const $dialogCancel = document.getElementById('dialog-cancel');
  const $dialogConfirm = document.getElementById('dialog-confirm');

  // ─── Initialization ────────────────────────────────────────

  async function init() {
    await loadWords();
    await loadSettings();
    bindEvents();
    renderVocabulary();
    updateStats();
  }

  async function loadWords() {
    try {
      const result = await chrome.storage.local.get('words');
      words = result.words || [];
    } catch (e) {
      console.error('[PaperVocab] Failed to load words:', e);
      words = [];
    }
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get('settings');
      const settings = result.settings || {};
      reviewBatchSize = settings.reviewBatchSize || 20;
    } catch (e) {
      console.error('[PaperVocab] Failed to load settings:', e);
    }
  }

  // ─── Event Binding ─────────────────────────────────────────

  function bindEvents() {
    // Tab switching
    document.querySelectorAll('.pv-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Empty state settings button
    document.getElementById('btn-empty-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Search input with debounce
    $searchInput.addEventListener('input', debounceLocal(() => {
      searchQuery = $searchInput.value.trim().toLowerCase();
      renderVocabulary();
    }, 300));

    // Sort buttons
    document.querySelectorAll('.pv-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sortBy = btn.dataset.sort;
        document.querySelectorAll('.pv-sort-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderVocabulary();
      });
    });

    // Review buttons
    document.getElementById('btn-start-review').addEventListener('click', startReview);
    document.getElementById('btn-review-back').addEventListener('click', () => {
      reviewState = 'idle';
      renderReview();
    });

    $reviewCard.addEventListener('click', flipCard);

    document.getElementById('btn-know').addEventListener('click', () => rateCard('know'));
    document.getElementById('btn-fuzzy').addEventListener('click', () => rateCard('fuzzy'));
    document.getElementById('btn-unknown').addEventListener('click', () => rateCard('unknown'));

    document.getElementById('btn-again').addEventListener('click', () => {
      reviewState = 'idle';
      renderReview();
    });

    document.getElementById('btn-back-vocab').addEventListener('click', () => {
      switchTab('vocabulary');
    });

    // Dialog
    $dialogCancel.addEventListener('click', closeDialog);
    $dialogOverlay.addEventListener('click', (e) => {
      if (e.target === $dialogOverlay) closeDialog();
    });
  }

  // ─── Tab Switching ─────────────────────────────────────────

  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.pv-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.pv-tab-content').forEach((c) => {
      c.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');

    if (tabName === 'review') {
      reviewState = 'idle';
      renderReview();
    }
  }

  // ─── Vocabulary Rendering ──────────────────────────────────

  function renderVocabulary() {
    let filtered = words;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter((w) =>
        w.word.toLowerCase().includes(searchQuery) ||
        (w.definition && w.definition.toLowerCase().includes(searchQuery))
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'queryCount':
          return (b.queryCount || 0) - (a.queryCount || 0);
        case 'createdAt':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'word':
          return (a.word || '').localeCompare(b.word || '');
        default:
          return 0;
      }
    });

    // Show empty state or list
    if (words.length === 0 && !searchQuery) {
      $wordList.style.display = 'none';
      $emptyState.style.display = 'flex';
      return;
    }

    $wordList.style.display = 'block';
    $emptyState.style.display = 'none';

    if (filtered.length === 0) {
      $wordList.innerHTML = `<div style="text-align:center; padding:32px; color:#9CA3AF; font-size:13px;">未找到匹配的单词</div>`;
      return;
    }

    $wordList.innerHTML = filtered.map((w) => renderWordItem(w)).join('');

    // Bind click events for expand/collapse
    $wordList.querySelectorAll('.pv-word-summary').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        toggleExpand(id);
      });
    });

    // Bind delete and edit buttons
    $wordList.querySelectorAll('.pv-btn-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteDialog(btn.dataset.id);
      });
    });

    $wordList.querySelectorAll('.pv-btn-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startEdit(btn.dataset.id);
      });
    });
  }

  function renderWordItem(w) {
    const isExpanded = expandedWordId === w.id;
    const esc = escapeHtmlLocal;
    const dateStr = formatDateLocal(w.createdAt);

    let detailHtml = '';
    if (isExpanded) {
      const contextsHtml = (w.contexts || [])
        .map(
          (ctx) => `
          <div class="pv-detail-context">
            <div>${esc(ctx.sentence || '')}</div>
            <div class="pv-detail-context-time">${esc(ctx.sourceTitle || '')} — ${formatDateLocal(ctx.queriedAt)}</div>
          </div>
        `
        )
        .join('');

      const isEditing = editingWordId === w.id;
      let definitionHtml;
      if (isEditing) {
        definitionHtml = `
          <textarea class="pv-edit-area" id="edit-area-${w.id}">${esc(w.definition || '')}</textarea>
          <div class="pv-edit-actions">
            <button class="pv-btn-save-edit" onclick="window.__pvSaveEdit('${w.id}')">保存</button>
            <button class="pv-btn-cancel-edit" onclick="window.__pvCancelEdit()">取消</button>
          </div>
        `;
      } else {
        definitionHtml = `<div class="pv-detail-text">${esc(w.definition || '')}</div>`;
      }

      detailHtml = `
        <div class="pv-word-detail" style="display:block;">
          <div class="pv-detail-section">
            <div class="pv-detail-label">释义</div>
            ${definitionHtml}
          </div>
          ${w.example ? `
          <div class="pv-detail-section">
            <div class="pv-detail-label">例句</div>
            <div class="pv-detail-example">${esc(w.example)}</div>
          </div>
          ` : ''}
          ${contextsHtml ? `
          <div class="pv-detail-section">
            <div class="pv-detail-label">查询记录</div>
            ${contextsHtml}
          </div>
          ` : ''}
          <div class="pv-detail-actions">
            <button class="pv-btn-edit" data-id="${w.id}">编辑释义</button>
            <button class="pv-btn-delete" data-id="${w.id}">删除</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="pv-word-item ${isExpanded ? 'expanded' : ''}">
        <div class="pv-word-summary" data-id="${w.id}">
          <div class="pv-word-main">
            <div>
              <span class="pv-word-name">${esc(w.word)}</span>
              <span class="pv-word-phonetic">${esc(w.phonetic || '')}</span>
            </div>
            <div class="pv-word-def-preview">${esc(w.definition || '')}</div>
          </div>
          <div class="pv-word-meta">
            <span class="pv-word-count-badge">×${w.queryCount || 1}</span>
            <span class="pv-word-date">${dateStr}</span>
          </div>
        </div>
        ${detailHtml}
      </div>
    `;
  }

  function toggleExpand(id) {
    expandedWordId = expandedWordId === id ? null : id;
    editingWordId = null;
    renderVocabulary();
  }

  // ─── Edit ──────────────────────────────────────────────────

  function startEdit(id) {
    editingWordId = id;
    renderVocabulary();
    // Focus on textarea
    setTimeout(() => {
      const textarea = document.getElementById(`edit-area-${id}`);
      if (textarea) textarea.focus();
    }, 50);
  }

  // Global functions for inline onclick handlers
  window.__pvSaveEdit = async function (id) {
    const textarea = document.getElementById(`edit-area-${id}`);
    if (!textarea) return;
    const newDef = textarea.value.trim();
    const wordIdx = words.findIndex((w) => w.id === id);
    if (wordIdx === -1) return;

    words[wordIdx].definition = newDef;
    words[wordIdx].updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ words });
    editingWordId = null;
    renderVocabulary();
  };

  window.__pvCancelEdit = function () {
    editingWordId = null;
    renderVocabulary();
  };

  // ─── Delete ────────────────────────────────────────────────

  function showDeleteDialog(id) {
    pendingDeleteId = id;
    const word = words.find((w) => w.id === id);
    $dialogTitle.textContent = '确认删除';
    $dialogBody.textContent = `确定要删除「${word ? word.word : ''}」吗？此操作不可撤销。`;
    $dialogOverlay.style.display = 'flex';

    // Bind confirm once
    $dialogConfirm.onclick = async () => {
      if (pendingDeleteId) {
        words = words.filter((w) => w.id !== pendingDeleteId);
        await chrome.storage.local.set({ words });
        if (expandedWordId === pendingDeleteId) expandedWordId = null;
        pendingDeleteId = null;
        closeDialog();
        renderVocabulary();
        updateStats();
      }
    };
  }

  function closeDialog() {
    $dialogOverlay.style.display = 'none';
    pendingDeleteId = null;
  }

  // ─── Statistics ────────────────────────────────────────────

  function updateStats() {
    const total = words.length;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekCount = words.filter((w) => new Date(w.createdAt) >= weekAgo).length;
    const masteredCount = words.filter((w) => w.mastered).length;

    $statTotal.textContent = `总计: ${total} 词`;
    $statWeek.textContent = `本周 +${weekCount}`;
    $statMastered.textContent = `已掌握 ${masteredCount}`;
  }

  // ─── Review ────────────────────────────────────────────────

  function renderReview() {
    $reviewIdle.style.display = reviewState === 'idle' ? 'flex' : 'none';
    $reviewCardView.style.display = reviewState === 'reviewing' ? 'flex' : 'none';
    $reviewCompleted.style.display = reviewState === 'completed' ? 'flex' : 'none';

    if (reviewState === 'idle') {
      const unmastered = words.filter((w) => !w.mastered);
      $reviewCount.textContent = unmastered.length;
      document.getElementById('btn-start-review').disabled = unmastered.length === 0;
    }

    if (reviewState === 'reviewing') {
      renderCurrentCard();
    }

    if (reviewState === 'completed') {
      document.getElementById('stat-know').textContent = reviewResults.know;
      document.getElementById('stat-fuzzy').textContent = reviewResults.fuzzy;
      document.getElementById('stat-unknown').textContent = reviewResults.unknown;
    }
  }

  function startReview() {
    const range = document.querySelector('input[name="review-range"]:checked').value;
    let pool = [];

    switch (range) {
      case 'unmastered':
        pool = words.filter((w) => !w.mastered);
        break;
      case 'unknown':
        pool = words.filter((w) => !w.mastered && (w.masteryLevel || 0) === 0);
        break;
      case 'frequent':
        pool = words.filter((w) => (w.queryCount || 0) >= 3);
        break;
      case 'random':
        pool = [...words];
        break;
    }

    if (pool.length === 0) {
      return;
    }

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Limit to batch size
    reviewCards = pool.slice(0, reviewBatchSize);
    currentIndex = 0;
    isFlipped = false;
    reviewResults = { know: 0, fuzzy: 0, unknown: 0 };
    reviewState = 'reviewing';
    renderReview();
  }

  function renderCurrentCard() {
    if (currentIndex >= reviewCards.length) {
      reviewState = 'completed';
      renderReview();
      return;
    }

    const card = reviewCards[currentIndex];
    $reviewProgress.textContent = `${currentIndex + 1} / ${reviewCards.length}`;

    $cardWord.textContent = card.word;
    $cardCount.textContent = `×${card.queryCount || 1}`;

    $cardBackWord.textContent = card.word;
    $cardBackPhonetic.textContent = card.phonetic || '';
    $cardBackDef.textContent = card.definition || '';
    $cardBackExample.textContent = card.example || '';

    // Reset flip state
    isFlipped = false;
    $reviewCard.classList.remove('flipped');
  }

  function flipCard() {
    isFlipped = !isFlipped;
    $reviewCard.classList.toggle('flipped', isFlipped);
  }

  async function rateCard(rating) {
    const card = reviewCards[currentIndex];
    if (!card) return;

    // Update mastery level
    let newLevel = card.masteryLevel || 0;
    switch (rating) {
      case 'know':
        newLevel = Math.min(newLevel + 1, 3);
        reviewResults.know++;
        break;
      case 'fuzzy':
        // No change
        reviewResults.fuzzy++;
        break;
      case 'unknown':
        newLevel = 0;
        reviewResults.unknown++;
        break;
    }

    const mastered = newLevel >= 3;

    // Update in words array
    const idx = words.findIndex((w) => w.id === card.id);
    if (idx !== -1) {
      words[idx].masteryLevel = newLevel;
      words[idx].mastered = mastered;
      words[idx].updatedAt = new Date().toISOString();
    }

    // Save to storage
    await chrome.storage.local.set({ words });

    // Next card
    currentIndex++;
    renderCurrentCard();
    updateStats();
  }

  // ─── Utility Functions (local) ─────────────────────────────

  function escapeHtmlLocal(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  function formatDateLocal(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (e) {
      return '';
    }
  }

  function debounceLocal(fn, delay) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─── Start ─────────────────────────────────────────────────

  init();
  console.log('[PaperVocab] Popup loaded');
})();
