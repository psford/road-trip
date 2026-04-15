describe('UploadUtils.backoffMs', () => {
    it('returns value in expected range for attempt 0', () => {
        const result = UploadUtils.backoffMs(0);
        // base=1000, cap=30000
        // min(2^0 * 1000, 30000) + jitter(0, min(3*1000, 30000) - 1000)
        // = 1000 + jitter(0, 2000)
        expect(result).toBeGreaterThanOrEqual(1000);
        expect(result).toBeLessThanOrEqual(3000);
    });

    it('returns value in expected range for attempt 1', () => {
        const result = UploadUtils.backoffMs(1);
        // min(2^1 * 1000, 30000) + jitter(0, min(3*2000, 30000) - 2000)
        // = 2000 + jitter(0, 4000)
        expect(result).toBeGreaterThanOrEqual(2000);
        expect(result).toBeLessThanOrEqual(6000);
    });

    it('caps exponential but applies jitter above base', () => {
        const result = UploadUtils.backoffMs(10); // 2^10 * 1000 = 1024000, capped to 30000
        // With jitter up to 2000, range is [30000, 32000]
        expect(result).toBeGreaterThanOrEqual(30000);
        expect(result).toBeLessThanOrEqual(32000);
    });

    it('shows roughly monotonic growth across attempts', () => {
        const samples = [];
        for (let attempt = 0; attempt < 6; attempt++) {
            const values = [];
            for (let i = 0; i < 10; i++) {
                values.push(UploadUtils.backoffMs(attempt));
            }
            const avg = values.reduce((a, b) => a + b) / values.length;
            samples.push(avg);
        }
        // Check general increasing trend (allow small variations due to randomness)
        expect(samples[5]).toBeGreaterThan(samples[0]);
    });
});

describe('UploadUtils.makeBlockId', () => {
    it('returns consistent-length base64 string', () => {
        const id = UploadUtils.makeBlockId(0);
        // Valid base64: alphanumeric, +, /, =
        expect(/^[A-Za-z0-9+/=]+$/.test(id)).toBe(true);
        expect(id.length).toBeGreaterThan(0);
    });

    it('all block IDs have equal length', () => {
        const id0 = UploadUtils.makeBlockId(0);
        const id1 = UploadUtils.makeBlockId(1);
        const id100 = UploadUtils.makeBlockId(100);
        const id99999 = UploadUtils.makeBlockId(99999);
        expect(id0.length).toBe(id1.length);
        expect(id1.length).toBe(id100.length);
        expect(id100.length).toBe(id99999.length);
    });

    it('is deterministic per index', () => {
        const id1 = UploadUtils.makeBlockId(42);
        const id2 = UploadUtils.makeBlockId(42);
        expect(id1).toBe(id2);
    });

    it('is distinct across indices', () => {
        const id0 = UploadUtils.makeBlockId(0);
        const id1 = UploadUtils.makeBlockId(1);
        const id2 = UploadUtils.makeBlockId(999);
        expect(new Set([id0, id1, id2]).size).toBe(3);
    });
});

describe('UploadUtils.sliceFile', () => {
    it('yields correct chunks from 10MB file with 4MB chunkSize', () => {
        const size = 10 * 1024 * 1024; // 10 MB
        const blob = new Blob([new ArrayBuffer(size)]);
        const chunkSize = 4 * 1024 * 1024; // 4 MB

        const chunks = Array.from(UploadUtils.sliceFile(blob, chunkSize));

        expect(chunks).toHaveLength(3);
        expect(chunks[0].index).toBe(0);
        expect(chunks[0].blob.size).toBe(4 * 1024 * 1024);
        expect(chunks[0].start).toBe(0);
        expect(chunks[0].end).toBe(4 * 1024 * 1024);

        expect(chunks[1].index).toBe(1);
        expect(chunks[1].blob.size).toBe(4 * 1024 * 1024);

        expect(chunks[2].index).toBe(2);
        expect(chunks[2].blob.size).toBe(2 * 1024 * 1024);
        expect(chunks[2].end).toBe(size);
    });

    it('yields blockId for each chunk with consistent length', () => {
        const blob = new Blob([new ArrayBuffer(5 * 1024 * 1024)]);
        const chunks = Array.from(UploadUtils.sliceFile(blob, 2 * 1024 * 1024));

        const blockIds = chunks.map(c => c.blockId);
        expect(blockIds.length).toBeGreaterThan(1);
        // All block IDs should have the same length
        const lengths = new Set(blockIds.map(id => id.length));
        expect(lengths.size).toBe(1);
    });

    it('handles default chunkSize of 4MB', () => {
        const blob = new Blob([new ArrayBuffer(5 * 1024 * 1024)]);
        const chunks = Array.from(UploadUtils.sliceFile(blob));

        expect(chunks[0].blob.size).toBe(4 * 1024 * 1024);
        expect(chunks[1].blob.size).toBe(1 * 1024 * 1024);
    });

    it('handles small files in single chunk', () => {
        const blob = new Blob([new ArrayBuffer(100)]);
        const chunks = Array.from(UploadUtils.sliceFile(blob, 4 * 1024 * 1024));

        expect(chunks).toHaveLength(1);
        expect(chunks[0].blob.size).toBe(100);
    });
});

describe('UploadUtils.redactSasForLog', () => {
    it('redacts sig parameter', () => {
        const url = 'https://storage.blob.core.windows.net/container?sig=abc123def456&se=2025-01-01';
        const redacted = UploadUtils.redactSasForLog(url);
        expect(redacted).toContain('sig=REDACTED');
        expect(redacted).not.toContain('sig=abc123def456');
    });

    it('redacts se parameter', () => {
        const url = 'https://storage.blob.core.windows.net/container?se=2025-01-01T12:00:00Z&other=value';
        const redacted = UploadUtils.redactSasForLog(url);
        expect(redacted).toContain('se=REDACTED');
        expect(redacted).not.toContain('se=2025-01-01T12:00:00Z');
    });

    it('preserves other parameters', () => {
        const url = 'https://storage.blob.core.windows.net/container?sv=2023-11-03&ss=bfqt&srt=sco&sp=rwdlac';
        const redacted = UploadUtils.redactSasForLog(url);
        expect(redacted).toContain('sv=2023-11-03');
        expect(redacted).toContain('ss=bfqt');
    });

    it('handles URL with both sig and se', () => {
        const url = 'https://storage.blob.core.windows.net/container?sv=2023&sig=SECRET1&se=2025-01-01&sp=rw';
        const redacted = UploadUtils.redactSasForLog(url);
        expect(redacted).toContain('sig=REDACTED');
        expect(redacted).toContain('se=REDACTED');
        expect(redacted).toContain('sv=2023');
        expect(redacted).toContain('sp=rw');
    });
});

describe('UploadUtils.newGuid', () => {
    it('returns a valid UUID format string', () => {
        const guid = UploadUtils.newGuid();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(uuidRegex.test(guid)).toBe(true);
    });

    it('generates different GUIDs on each call', () => {
        const guid1 = UploadUtils.newGuid();
        const guid2 = UploadUtils.newGuid();
        expect(guid1).not.toBe(guid2);
    });
});
