/**
 * Resume Banner — Surface non-terminal uploads on trip page load
 * Subscribes to upload:committed, upload:failed events to update count
 * Auto-unmounts when all items complete
 * Verifies AC4.1, AC4.2, AC4.3
 */

const ResumeBanner = (() => {
  let _container = null;
  let _tripToken = null;
  let _isVisible = false;
  let _eventHandlers = {}; // Store handler references for removal

  /**
   * Render the banner HTML
   * @param {number} count - Number of non-terminal items
   * @returns {string} - HTML content
   */
  function renderBanner(count) {
    const uploadWord = count === 1 ? 'upload' : 'uploads';
    return `
      <div class="resume-banner">
        <div class="resume-banner__content">
          <span class="resume-banner__message">⚠ ${count} ${uploadWord} paused</span>
          <div class="resume-banner__buttons">
            <button class="resume-banner__resume">Resume</button>
            <button class="resume-banner__retry-failed">Retry failed</button>
            <button class="resume-banner__discard-all">Discard all</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Recount non-terminal items and update banner
   */
  async function recountAndUpdate() {
    if (!_container || !_tripToken) return;

    const items = await StorageAdapter.listNonTerminal(_tripToken);

    if (items.length === 0) {
      unmount();
      return;
    }

    _container.innerHTML = renderBanner(items.length);
    wireupButtons();
  }

  /**
   * Wire up button click handlers
   */
  function wireupButtons() {
    const resumeBtn = _container.querySelector('.resume-banner__resume');
    const retryFailedBtn = _container.querySelector('.resume-banner__retry-failed');
    const discardAllBtn = _container.querySelector('.resume-banner__discard-all');

    if (resumeBtn) {
      resumeBtn.addEventListener('click', async () => {
        await UploadQueue.resume(_tripToken);
        // Banner will update via event listeners
      });
    }

    if (retryFailedBtn) {
      retryFailedBtn.addEventListener('click', async () => {
        const items = await StorageAdapter.listNonTerminal(_tripToken);
        const failedItems = items.filter(item => item.status === 'failed');
        // Fire off retries (don't wait between them)
        Promise.all(failedItems.map(item => UploadQueue.retry(item.upload_id)));
        // Banner will update via event listeners
      });
    }

    if (discardAllBtn) {
      discardAllBtn.addEventListener('click', async () => {
        await UploadQueue.discardAll(_tripToken);
        // Banner will update via event listeners
      });
    }
  }

  /**
   * Setup event listeners for upload state changes
   */
  function setupEventListeners() {
    const handleUploadEvent = async (e) => {
      // Only handle events for this banner's trip token
      if (e.detail && e.detail.tripToken && e.detail.tripToken !== _tripToken) {
        return;
      }
      await recountAndUpdate();
    };

    // Store handler references for cleanup on unmount
    _eventHandlers.uploadCommitted = handleUploadEvent;
    _eventHandlers.uploadFailed = handleUploadEvent;
    _eventHandlers.uploadAborted = handleUploadEvent;

    // Listen for events that affect the count
    document.addEventListener('upload:committed', _eventHandlers.uploadCommitted);
    document.addEventListener('upload:failed', _eventHandlers.uploadFailed);
    document.addEventListener('upload:aborted', _eventHandlers.uploadAborted);
  }

  /**
   * Unmount the banner and remove event listeners
   */
  function unmount() {
    if (_container) {
      _container.innerHTML = '';
      _isVisible = false;
    }

    // Remove event listeners to prevent memory leak
    if (_eventHandlers.uploadCommitted) {
      document.removeEventListener('upload:committed', _eventHandlers.uploadCommitted);
    }
    if (_eventHandlers.uploadFailed) {
      document.removeEventListener('upload:failed', _eventHandlers.uploadFailed);
    }
    if (_eventHandlers.uploadAborted) {
      document.removeEventListener('upload:aborted', _eventHandlers.uploadAborted);
    }
    _eventHandlers = {};
  }

  return {
    /**
     * Mount the banner and fetch initial state
     * @param {HTMLElement} container - The container element
     * @param {string} tripToken - The trip secret token
     */
    async mount(container, tripToken) {
      _container = container;
      _tripToken = tripToken;

      // Fetch initial list of non-terminal items
      const items = await StorageAdapter.listNonTerminal(tripToken);

      // If no items, don't render
      if (items.length === 0) {
        unmount();
        return;
      }

      // Render initial banner
      _container.innerHTML = renderBanner(items.length);
      _isVisible = true;
      wireupButtons();
      setupEventListeners();
    },

    /**
     * Explicitly unmount the banner
     */
    unmount,
  };
})();
