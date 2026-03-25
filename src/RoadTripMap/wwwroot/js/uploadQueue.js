/**
 * Upload Queue - Manages concurrent bulk photo uploads with floating status bar.
 * Module pattern matching PostUI, MapUI, etc.
 */

const UploadQueue = {
    queue: [],
    active: 0,
    maxConcurrent: 3,
    completed: 0,
    failed: 0,
    total: 0,
    statusBar: null,
    statusList: null,
    expanded: false,
    onEachComplete: null,
    onAllComplete: null,
    items: new Map(),

    /**
     * Start a bulk upload.
     * @param {string} secretToken
     * @param {Array<{file: File, metadata: Object}>} filesWithMetadata - GPS-tagged files with extracted metadata
     * @param {Object} callbacks - { onEachComplete: fn(response), onAllComplete: fn(results) }
     */
    start(secretToken, filesWithMetadata, callbacks) {
        this.queue = [...filesWithMetadata];
        this.total = filesWithMetadata.length;
        this.completed = 0;
        this.failed = 0;
        this.active = 0;
        this.items.clear();
        this.onEachComplete = callbacks.onEachComplete || null;
        this.onAllComplete = callbacks.onAllComplete || null;

        // Build item tracking
        filesWithMetadata.forEach((item, i) => {
            this.items.set(i, { file: item.file, status: 'queued', retries: 0 });
        });

        this.createStatusBar();
        this.updateStatusBar();
        this.drain(secretToken);
    },

    async drain(secretToken) {
        while (this.queue.length > 0 && this.active < this.maxConcurrent) {
            const item = this.queue.shift();
            const index = [...this.items.entries()].find(([, v]) => v.file === item.file)?.[0];
            this.active++;
            this.items.get(index).status = 'uploading';
            this.updateStatusBar();

            this.uploadOne(secretToken, item, index).then(() => {
                this.active--;
                this.drain(secretToken);
            });
        }

        if (this.active === 0 && this.queue.length === 0) {
            this.onFinished();
        }
    },

    async uploadOne(secretToken, item, index) {
        const { file, metadata } = item;
        try {
            const response = await PostService.uploadPhoto(
                secretToken, file,
                metadata.gps.latitude, metadata.gps.longitude,
                null, metadata.timestamp
            );
            this.items.get(index).status = 'done';
            this.completed++;
            this.updateStatusBar();
            if (this.onEachComplete) this.onEachComplete(response);
        } catch (err) {
            const tracked = this.items.get(index);
            if (tracked.retries < 1) {
                tracked.retries++;
                tracked.status = 'retrying';
                this.updateStatusBar();
                try {
                    const response = await PostService.uploadPhoto(
                        secretToken, file,
                        metadata.gps.latitude, metadata.gps.longitude,
                        null, metadata.timestamp
                    );
                    tracked.status = 'done';
                    this.completed++;
                    this.updateStatusBar();
                    if (this.onEachComplete) this.onEachComplete(response);
                } catch (retryErr) {
                    tracked.status = 'failed';
                    this.failed++;
                    this.updateStatusBar();
                    console.error('Upload failed after retry:', file.name, retryErr);
                }
            } else {
                tracked.status = 'failed';
                this.failed++;
                this.updateStatusBar();
            }
        }
    },

    onFinished() {
        const bar = this.statusBar;
        if (!bar) return;

        const label = bar.querySelector('.upload-status-label');
        if (this.failed > 0) {
            label.textContent = `${this.completed} uploaded, ${this.failed} failed`;
        } else {
            label.textContent = `${this.completed} photos uploaded`;
        }
        const fill = bar.querySelector('.upload-status-fill');
        fill.style.width = '100%';

        setTimeout(() => {
            if (this.statusBar) {
                this.statusBar.classList.add('upload-status-dismiss');
                setTimeout(() => this.removeStatusBar(), 300);
            }
        }, 3000);

        if (this.onAllComplete) this.onAllComplete();
    },

    createStatusBar() {
        this.removeStatusBar();
        const bar = document.createElement('div');
        bar.className = 'upload-status-bar';
        bar.innerHTML = `
            <div class="upload-status-collapsed" tabindex="0">
                <div class="upload-status-fill"></div>
                <span class="upload-status-label">0/${this.total} uploading...</span>
                <button class="upload-status-close" aria-label="Dismiss">&times;</button>
            </div>
            <div class="upload-status-expanded" style="display:none">
                <div class="upload-status-list"></div>
            </div>
        `;

        bar.querySelector('.upload-status-collapsed').addEventListener('click', (e) => {
            if (e.target.closest('.upload-status-close')) {
                this.dismissStatusBar();
                return;
            }
            this.toggleExpanded();
        });

        bar.querySelector('.upload-status-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.dismissStatusBar();
        });

        document.body.appendChild(bar);
        this.statusBar = bar;
        this.statusList = bar.querySelector('.upload-status-list');
    },

    updateStatusBar() {
        if (!this.statusBar) return;
        const done = this.completed + this.failed;
        const label = this.statusBar.querySelector('.upload-status-label');
        label.textContent = `${done}/${this.total} uploading...`;

        const fill = this.statusBar.querySelector('.upload-status-fill');
        fill.style.width = this.total > 0 ? `${(done / this.total) * 100}%` : '0%';

        // Update expanded list
        if (this.statusList) {
            this.statusList.innerHTML = '';
            this.items.forEach((item, index) => {
                const row = document.createElement('div');
                row.className = 'upload-status-item';
                const icon = item.status === 'done' ? '✓'
                    : item.status === 'uploading' || item.status === 'retrying' ? '◌'
                    : item.status === 'failed' ? '✗'
                    : '·';
                const statusClass = item.status === 'done' ? 'status-done'
                    : item.status === 'failed' ? 'status-failed'
                    : item.status === 'uploading' || item.status === 'retrying' ? 'status-active'
                    : 'status-queued';
                row.innerHTML = `<span class="upload-status-icon ${statusClass}">${icon}</span> <span>${item.file.name}</span>`;
                this.statusList.appendChild(row);
            });
        }
    },

    toggleExpanded() {
        this.expanded = !this.expanded;
        const exp = this.statusBar.querySelector('.upload-status-expanded');
        exp.style.display = this.expanded ? 'block' : 'none';
    },

    dismissStatusBar() {
        if (this.statusBar) {
            this.statusBar.classList.add('upload-status-dismiss');
            setTimeout(() => this.removeStatusBar(), 300);
        }
        // Show badge on add photo button if uploads still in progress
        if (this.active > 0) {
            const btn = document.getElementById('addPhotoButton');
            if (btn) {
                const remaining = this.total - this.completed - this.failed;
                btn.dataset.uploadBadge = remaining;
                btn.classList.add('has-upload-badge');
            }
        }
    },

    removeStatusBar() {
        if (this.statusBar) {
            this.statusBar.remove();
            this.statusBar = null;
            this.statusList = null;
            this.expanded = false;
        }
    },

    /**
     * Show a non-GPS message in the status bar
     * @param {string} message
     */
    addMessage(message) {
        if (!this.statusList) return;
        const row = document.createElement('div');
        row.className = 'upload-status-item upload-status-message';
        row.textContent = message;
        this.statusList.appendChild(row);
    }
};
