const ImageProcessor = (() => {
    // ==================== Subcomponent A: Module skeleton and constants ====================
    const OVERSIZE_THRESHOLD_BYTES = 14 * 1024 * 1024; // 14 MB
    const DISPLAY_MAX_DIMENSION = 1920;
    const THUMB_MAX_DIMENSION = 300;
    const DISPLAY_JPEG_QUALITY = 0.85;
    const THUMB_JPEG_QUALITY = 0.75;
    const COMPRESSION_MAX_SIZE_MB = 14;

    // CDN URLs (pinned versions)
    const BROWSER_IMAGE_COMPRESSION_CDN = 'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm';
    const PIEXIFJS_CDN = 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/+esm';
    const HEIC2ANY_CDN = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm';

    // Lazy-loaded module caches (promises, not values)
    let _browserImageCompressionPromise = null;
    let _piexifjsPromise = null;
    let _heic2anyPromise = null;

    // ==================== Subcomponent B: Lazy-loading functions ====================
    async function _loadBrowserImageCompression() {
        if (!_browserImageCompressionPromise) {
            _browserImageCompressionPromise = import(BROWSER_IMAGE_COMPRESSION_CDN)
                .then(mod => mod.default);
        }
        return _browserImageCompressionPromise;
    }

    async function _loadPiexifjs() {
        if (!_piexifjsPromise) {
            _piexifjsPromise = import(PIEXIFJS_CDN)
                .then(mod => mod.default || mod);
        }
        return _piexifjsPromise;
    }

    async function _loadHeic2any() {
        if (!_heic2anyPromise) {
            _heic2anyPromise = import(HEIC2ANY_CDN)
                .then(mod => mod.default || mod);
        }
        return _heic2anyPromise;
    }

    // ==================== Subcomponent C: Data URL / Blob conversion helpers ====================
    function _fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file as data URL'));
            reader.readAsDataURL(file);
        });
    }

    function _blobToDataUrl(blob) {
        return _fileToDataUrl(blob); // FileReader accepts both File and Blob
    }

    function _dataUrlToBlob(dataUrl) {
        const [header, base64] = dataUrl.split(',');
        const mimeMatch = header.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    // ==================== Subcomponent D: Canvas-based tier generation ====================
    function _loadImage(blobOrFile) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blobOrFile);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image for processing'));
            };
            img.src = url;
        });
    }

    async function _generateTier(sourceFile, maxDimension, jpegQuality) {
        const img = await _loadImage(sourceFile);

        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const targetWidth = Math.round(img.width * scale);
        const targetHeight = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')),
                'image/jpeg',
                jpegQuality
            );
        });

        return blob;
    }

    // ==================== Subcomponent E: HEIC detection and conversion ====================
    function _isHeic(file) {
        const type = (file.type || '').toLowerCase();
        if (type === 'image/heic' || type === 'image/heif') return true;
        // iOS Safari sometimes doesn't set MIME type; check extension
        const name = (file.name || '').toLowerCase();
        return name.endsWith('.heic') || name.endsWith('.heif');
    }

    async function _convertHeicToJpeg(file) {
        const heic2any = await _loadHeic2any();
        const jpegBlob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.92 // High quality for the conversion step; compression happens later if needed
        });
        // heic2any may return a single Blob or an array; normalize to single Blob
        const result = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
        // Wrap as File to preserve name semantics downstream
        return new File([result], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), {
            type: 'image/jpeg'
        });
    }

    // ==================== Subcomponent F: EXIF reinjection ====================
    async function _reinjectExif(originalFile, processedBlob, exifData) {
        const piexif = await _loadPiexifjs();

        let exifObj;

        if (_isHeic(originalFile)) {
            // piexifjs cannot parse HEIC containers. Use the exifData already extracted
            // by exifr (passed in from processForUpload) to build the piexifjs EXIF object.
            // exifData shape: { latitude, longitude, DateTimeOriginal, Make, Model, ... }
            try {
                exifObj = { '0th': {}, 'Exif': {}, 'GPS': {} };

                if (exifData) {
                    // GPS IFD
                    if (exifData.latitude != null && exifData.longitude != null) {
                        const latRef = exifData.latitude >= 0 ? 'N' : 'S';
                        const lngRef = exifData.longitude >= 0 ? 'E' : 'W';
                        const toRational = (deg) => {
                            const d = Math.floor(Math.abs(deg));
                            const mFull = (Math.abs(deg) - d) * 60;
                            const m = Math.floor(mFull);
                            const s = Math.round((mFull - m) * 60 * 100);
                            return [[d, 1], [m, 1], [s, 100]];
                        };
                        exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef] = latRef;
                        exifObj['GPS'][piexif.GPSIFD.GPSLatitude] = toRational(exifData.latitude);
                        exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef] = lngRef;
                        exifObj['GPS'][piexif.GPSIFD.GPSLongitude] = toRational(exifData.longitude);
                    }

                    // DateTimeOriginal
                    if (exifData.DateTimeOriginal) {
                        const dt = new Date(exifData.DateTimeOriginal);
                        const pad = (n) => String(n).padStart(2, '0');
                        const formatted = `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
                        exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = formatted;
                    }

                    // Camera make/model if available
                    if (exifData.Make) exifObj['0th'][piexif.ImageIFD.Make] = exifData.Make;
                    if (exifData.Model) exifObj['0th'][piexif.ImageIFD.Model] = exifData.Model;
                }
            } catch (e) {
                // Could not construct EXIF from exifData -- return processed blob as-is
                return processedBlob;
            }
        } else {
            // For JPEG/PNG: load EXIF directly from the original file's data URL
            try {
                const originalDataUrl = await _fileToDataUrl(originalFile);
                exifObj = piexif.load(originalDataUrl);
            } catch (e) {
                // Original has no EXIF or piexifjs can't parse it -- return processed blob as-is
                return processedBlob;
            }
        }

        const processedDataUrl = await _blobToDataUrl(processedBlob);
        const withExifDataUrl = piexif.insert(piexif.dump(exifObj), processedDataUrl);
        return _dataUrlToBlob(withExifDataUrl);
    }

    // ==================== Subcomponent G: Main processForUpload function ====================
    async function processForUpload(file, exifData) {
        const startTime = performance.now();
        const originalBytes = file.size;

        let workingFile = file;
        let compressionApplied = false;
        let heicConverted = false;

        // Step 1: HEIC conversion (must happen before anything else since Canvas can't decode HEIC)
        if (_isHeic(file)) {
            workingFile = await _convertHeicToJpeg(file);
            heicConverted = true;
        }

        // Step 2: Generate display and thumb tiers from the working file
        // (Do this BEFORE compression so tiers are generated from highest-quality source)
        const [display, thumb] = await Promise.all([
            _generateTier(workingFile, DISPLAY_MAX_DIMENSION, DISPLAY_JPEG_QUALITY),
            _generateTier(workingFile, THUMB_MAX_DIMENSION, THUMB_JPEG_QUALITY),
        ]);

        // Step 3: Compress original if oversize
        let original = workingFile;
        if (workingFile.size > OVERSIZE_THRESHOLD_BYTES) {
            const compress = await _loadBrowserImageCompression();
            const compressed = await compress(workingFile, {
                maxSizeMB: COMPRESSION_MAX_SIZE_MB,
                maxWidthOrHeight: 4032, // iOS Safari Canvas limit safety
                useWebWorker: true,
                fileType: 'image/jpeg',
            });

            // Verify compression actually brought it under threshold
            if (compressed.size > OVERSIZE_THRESHOLD_BYTES) {
                throw new Error(
                    `Unable to compress image to under ${COMPRESSION_MAX_SIZE_MB} MB. ` +
                    `Original: ${(originalBytes / (1024 * 1024)).toFixed(1)} MB, ` +
                    `After compression: ${(compressed.size / (1024 * 1024)).toFixed(1)} MB. ` +
                    `Try using a smaller image.`
                );
            }

            // Reinject EXIF into compressed output
            original = await _reinjectExif(file, compressed, exifData);

            // Wrap as File to preserve name property
            if (!(original instanceof File)) {
                original = new File([original], workingFile.name, { type: 'image/jpeg' });
            }

            compressionApplied = true;
        } else if (heicConverted) {
            // HEIC was converted but NOT oversize -- still need EXIF reinjection on the converted file
            original = await _reinjectExif(file, workingFile, exifData);
            if (!(original instanceof File)) {
                original = new File([original], workingFile.name, { type: 'image/jpeg' });
            }
        }
        // else: sub-threshold non-HEIC -- original is byte-for-byte the input file (AC1.4)

        const durationMs = Math.round(performance.now() - startTime);

        return {
            original,
            display,
            thumb,
            compressionApplied,
            heicConverted,
            originalBytes,
            outputBytes: original.size,
            durationMs,
        };
    }

    return {
        processForUpload,
        // Exposed for testing only:
        _resetLazyLoaders() {
            _browserImageCompressionPromise = null;
            _piexifjsPromise = null;
            _heic2anyPromise = null;
        }
    };
})();
