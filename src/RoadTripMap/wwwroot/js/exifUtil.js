const ExifUtil = {
    async extractGps(file) {
        const gps = await exifr.gps(file);
        if (!gps) return null;
        return { latitude: gps.latitude, longitude: gps.longitude };
    },
    async extractTimestamp(file) {
        const data = await exifr.parse(file, ['DateTimeOriginal']);
        return data?.DateTimeOriginal || null;
    },
    async extractAll(file) {
        const gps = await this.extractGps(file);
        const timestamp = await this.extractTimestamp(file);
        return { gps, timestamp };
    }
};
