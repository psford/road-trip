const ExifUtil = {
    async extractGps(file) {
        try {
            const gps = await exifr.gps(file);
            if (!gps) {
                console.log(`[ExifUtil] No GPS data in ${file.name}`);
                return null;
            }
            const { latitude, longitude } = gps;
            // Validate coordinates are real numbers, not NaN
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                console.warn(`[ExifUtil] Invalid GPS coords in ${file.name}: lat=${latitude}, lng=${longitude}`);
                return null;
            }
            console.log(`[ExifUtil] GPS found in ${file.name}: ${latitude}, ${longitude}`);
            return { latitude, longitude };
        } catch (err) {
            console.warn(`[ExifUtil] GPS extraction failed for ${file.name}:`, err);
            return null;
        }
    },
    async extractTimestamp(file) {
        try {
            const data = await exifr.parse(file, ['DateTimeOriginal']);
            return data?.DateTimeOriginal || null;
        } catch (err) {
            console.warn(`[ExifUtil] Timestamp extraction failed for ${file.name}:`, err);
            return null;
        }
    },
    async extractAll(file) {
        const gps = await this.extractGps(file);
        const timestamp = await this.extractTimestamp(file);
        return { gps, timestamp };
    }
};
