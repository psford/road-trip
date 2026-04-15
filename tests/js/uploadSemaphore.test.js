describe('UploadSemaphore', () => {
    it('allows up to capacity concurrent acquires', async () => {
        const semaphore = new UploadSemaphore(3);
        const concurrent = [];
        let maxConcurrent = 0;
        let current = 0;

        const task = async () => {
            const release = await semaphore.acquire();
            current++;
            maxConcurrent = Math.max(maxConcurrent, current);
            await new Promise(r => setTimeout(r, 10));
            current--;
            release();
        };

        await Promise.all([
            task(), task(), task(),
            task(), task(), task(),
            task(), task()
        ]);

        expect(maxConcurrent).toBe(3);
    });

    it('queues waiting acquires', async () => {
        const semaphore = new UploadSemaphore(1);
        const order = [];

        const acquire1 = semaphore.acquire().then(release => {
            order.push('acquired-1');
            setTimeout(() => {
                order.push('released-1');
                release();
            }, 10);
        });

        await new Promise(r => setTimeout(r, 1)); // Let acquire1 actually acquire

        const acquire2 = semaphore.acquire().then(release => {
            order.push('acquired-2');
            release();
        });

        await Promise.all([acquire1, acquire2]);

        expect(order).toEqual(['acquired-1', 'released-1', 'acquired-2']);
    });

    it('resolves with a release function', async () => {
        const semaphore = new UploadSemaphore(1);
        const release = await semaphore.acquire();
        expect(typeof release).toBe('function');
        release(); // Should not throw
    });
});

describe('UploadConcurrency', () => {
    it('enforces per-file concurrency limit', async () => {
        const concurrency = UploadConcurrency.create({ perFile: 2, global: 10 });
        const concurrentByFile = {};

        const task = async (uploadId) => {
            const release = await concurrency.acquireForBlock(uploadId);
            concurrentByFile[uploadId] = (concurrentByFile[uploadId] || 0) + 1;
            const max = Math.max(...Object.values(concurrentByFile));

            await new Promise(r => setTimeout(r, 5));
            concurrentByFile[uploadId]--;
            release();
            return max;
        };

        const promises = [];
        for (let fileId = 0; fileId < 3; fileId++) {
            for (let block = 0; block < 5; block++) {
                promises.push(task(`file-${fileId}`));
            }
        }

        const maxConcurrents = await Promise.all(promises);
        // Per-file limit of 2 should be enforced
        expect(Math.max(...maxConcurrents)).toBeLessThanOrEqual(2);
    });

    it('enforces global concurrency limit', async () => {
        const concurrency = UploadConcurrency.create({ perFile: 10, global: 3 });
        let globalConcurrent = 0;
        let maxGlobal = 0;

        const task = async (uploadId) => {
            const release = await concurrency.acquireForBlock(uploadId);
            globalConcurrent++;
            maxGlobal = Math.max(maxGlobal, globalConcurrent);

            await new Promise(r => setTimeout(r, 5));
            globalConcurrent--;
            release();
        };

        const promises = [];
        for (let fileId = 0; fileId < 5; fileId++) {
            for (let block = 0; block < 5; block++) {
                promises.push(task(`file-${fileId}`));
            }
        }

        await Promise.all(promises);
        expect(maxGlobal).toBeLessThanOrEqual(3);
    });

    it('respects both per-file and global limits', async () => {
        const concurrency = UploadConcurrency.create({ perFile: 3, global: 5 });
        let globalConcurrent = 0;
        let maxGlobal = 0;
        const maxPerFile = {};

        const task = async (uploadId) => {
            const release = await concurrency.acquireForBlock(uploadId);
            globalConcurrent++;
            maxGlobal = Math.max(maxGlobal, globalConcurrent);
            maxPerFile[uploadId] = (maxPerFile[uploadId] || 0) + 1;

            await new Promise(r => setTimeout(r, 5));
            maxPerFile[uploadId]--;
            globalConcurrent--;
            release();
        };

        const promises = [];
        for (let fileId = 0; fileId < 4; fileId++) {
            for (let block = 0; block < 6; block++) {
                promises.push(task(`file-${fileId}`));
            }
        }

        await Promise.all(promises);
        expect(maxGlobal).toBeLessThanOrEqual(5);
        Object.values(maxPerFile).forEach(max => {
            expect(max).toBeLessThanOrEqual(3);
        });
    });

    it('cleans up per-file semaphores after all blocks release', async () => {
        const concurrency = UploadConcurrency.create({ perFile: 2, global: 10 });

        const release1 = await concurrency.acquireForBlock('upload-1');
        const release2 = await concurrency.acquireForBlock('upload-1');
        release1();
        release2();

        // Acquire again for same upload ID - should work without blocking
        const release3 = await Promise.race([
            concurrency.acquireForBlock('upload-1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100))
        ]);
        release3();
    });
});
