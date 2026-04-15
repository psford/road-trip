import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ResumeBanner', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'resumeBannerContainer';
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  describe('mount', () => {
    it('returns early and unmounts if there are no non-terminal items', async () => {
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue([]);

      await ResumeBanner.mount(container, 'test-token');

      expect(container.innerHTML).toBe('');
    });

    it('renders banner with count when items exist', async () => {
      const items = [
        { upload_id: 'id1', status: 'pending' },
        { upload_id: 'id2', status: 'uploading' },
      ];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);

      await ResumeBanner.mount(container, 'test-token');

      expect(container.querySelector('.resume-banner')).toBeTruthy();
      expect(container.textContent).toContain('2');
      expect(container.textContent).toContain('uploads paused');
    });

    it('renders Resume, Retry failed, and Discard all buttons', async () => {
      const items = [
        { upload_id: 'id1', status: 'pending' },
        { upload_id: 'id2', status: 'failed' },
      ];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);

      await ResumeBanner.mount(container, 'test-token');

      expect(container.querySelector('.resume-banner__resume')).toBeTruthy();
      expect(container.querySelector('.resume-banner__retry-failed')).toBeTruthy();
      expect(container.querySelector('.resume-banner__discard-all')).toBeTruthy();
    });

    it('calls UploadQueue.resume when Resume button clicked', async () => {
      const items = [{ upload_id: 'id1', status: 'pending' }];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);
      vi.spyOn(UploadQueue, 'resume').mockResolvedValue(undefined);

      await ResumeBanner.mount(container, 'test-token');

      const resumeBtn = container.querySelector('.resume-banner__resume');
      resumeBtn.click();

      expect(UploadQueue.resume).toHaveBeenCalledWith('test-token');
    });

    it('calls UploadQueue.retry for each failed item when Retry failed clicked', async () => {
      const items = [
        { upload_id: 'id1', status: 'pending' },
        { upload_id: 'id2', status: 'failed' },
        { upload_id: 'id3', status: 'failed' },
      ];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);
      vi.spyOn(UploadQueue, 'retry').mockResolvedValue(undefined);

      await ResumeBanner.mount(container, 'test-token');

      const retryBtn = container.querySelector('.resume-banner__retry-failed');
      retryBtn.click();

      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(UploadQueue.retry).toHaveBeenCalledWith('id2');
      expect(UploadQueue.retry).toHaveBeenCalledWith('id3');
      expect(UploadQueue.retry).toHaveBeenCalledTimes(2);
    });

    it('calls UploadQueue.discardAll when Discard all button clicked', async () => {
      const items = [{ upload_id: 'id1', status: 'pending' }];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);
      vi.spyOn(UploadQueue, 'discardAll').mockResolvedValue(undefined);

      await ResumeBanner.mount(container, 'test-token');

      const discardBtn = container.querySelector('.resume-banner__discard-all');
      discardBtn.click();

      expect(UploadQueue.discardAll).toHaveBeenCalledWith('test-token');
    });

    it('auto-unmounts when count reaches 0 after upload:committed event', async () => {
      const items = [{ upload_id: 'id1', status: 'pending', trip_token: 'test-token' }];
      let callCount = 0;
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? items : [];
      });

      await ResumeBanner.mount(container, 'test-token');
      expect(container.querySelector('.resume-banner')).toBeTruthy();

      // Dispatch upload:committed event
      document.dispatchEvent(
        new CustomEvent('upload:committed', {
          detail: {
            uploadId: 'id1',
            tripToken: 'test-token',
          },
        })
      );

      // Wait for async event handler
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(container.querySelector('.resume-banner')).toBeFalsy();
    });

    it('updates count when upload:failed event is dispatched', async () => {
      const items = [
        { upload_id: 'id1', status: 'pending', trip_token: 'test-token' },
        { upload_id: 'id2', status: 'pending', trip_token: 'test-token' },
      ];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);

      await ResumeBanner.mount(container, 'test-token');
      const initialText = container.textContent;
      expect(initialText).toContain('2');

      // Dispatch upload:failed event
      document.dispatchEvent(
        new CustomEvent('upload:failed', {
          detail: {
            uploadId: 'id1',
            tripToken: 'test-token',
            reason: 'network error',
          },
        })
      );

      // Wait for async event handler
      await new Promise(resolve => setTimeout(resolve, 100));

      // Banner should still be visible (items still exist in storage)
      expect(container.querySelector('.resume-banner')).toBeTruthy();
    });

    it('handles upload with singular "upload" when count is 1', async () => {
      const items = [{ upload_id: 'id1', status: 'pending' }];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);

      await ResumeBanner.mount(container, 'test-token');

      expect(container.textContent).toContain('1 upload paused');
    });

    it('handles upload with plural "uploads" when count is 2+', async () => {
      const items = [
        { upload_id: 'id1', status: 'pending' },
        { upload_id: 'id2', status: 'pending' },
      ];
      vi.spyOn(StorageAdapter, 'listNonTerminal').mockResolvedValue(items);

      await ResumeBanner.mount(container, 'test-token');

      expect(container.textContent).toContain('2 uploads paused');
    });
  });
});
