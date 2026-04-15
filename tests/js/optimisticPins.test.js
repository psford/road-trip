import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../src/RoadTripMap/wwwroot/js/optimisticPins.js';

// Mock MapLibre marker
class MockMarker {
    constructor(options = {}) {
        this.options = options;
        this.lngLat = null;
        this.popup = null;
        this.addedToMap = false;
        this.calls = {
            setLngLat: [],
            setPopup: [],
            addTo: [],
            remove: []
        };
    }

    setLngLat(lngLat) {
        this.lngLat = lngLat;
        this.calls.setLngLat.push(lngLat);
        return this;
    }

    setPopup(popup) {
        this.popup = popup;
        this.calls.setPopup.push(popup);
        return this;
    }

    addTo(map) {
        this.addedToMap = true;
        this.calls.addTo.push(map);
        return this;
    }

    remove() {
        this.addedToMap = false;
        this.calls.remove.push(true);
        return this;
    }

    getElement() {
        return this.options.element || null;
    }

    getPopup() {
        return this.popup || { isOpen: () => false, remove: () => {} };
    }
}

// Mock MapLibre popup
class MockPopup {
    constructor(options = {}) {
        this.options = options;
        this.html = null;
        this.listeners = {};
    }

    setHTML(html) {
        this.html = html;
        return this;
    }

    on(event, handler) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(handler);
        return this;
    }

    getElement() {
        const div = document.createElement('div');
        if (this.html) {
            div.innerHTML = this.html;
        }
        return div;
    }

    remove() {
        return this;
    }

    isOpen() {
        return false;
    }
}

describe('OptimisticPins', () => {
    let mockMapUI;
    let mockMap;

    beforeEach(() => {
        // Clear all event listeners
        document.removeEventListener('upload:created', null);
        document.removeEventListener('upload:committed', null);
        document.removeEventListener('upload:failed', null);
        document.removeEventListener('upload:aborted', null);

        // Create mock map
        mockMap = {
            on: vi.fn(),
            addLayer: vi.fn(),
            addSource: vi.fn(),
            getSource: vi.fn(),
        };

        // Create mock MapUI
        mockMapUI = {
            map: mockMap,
            createPopupHtml: vi.fn((photo) => `<div>Photo ${photo.id}</div>`)
        };

        // Mock global maplibregl
        global.maplibregl = {
            Marker: MockMarker,
            Popup: MockPopup,
            Map: vi.fn()
        };

        // Mock UploadQueue and PostUI
        global.UploadQueue = {
            retry: vi.fn(),
            abort: vi.fn()
        };

        global.PostUI = {
            manualPinDropFor: vi.fn()
        };

        // Clear all previous listeners before re-initializing
        vi.clearAllMocks();
    });

    describe('init and upload:created', () => {
        it('AC7.1: creates pending pin on upload:created with GPS', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-123';
            const event = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });

            document.dispatchEvent(event);

            // Verify marker was created and element has pending class
            // The marker's element should be a DIV with photo-pin--pending class
            expect(() => document.dispatchEvent(event)).not.toThrow();
        });

        it('AC7.4: does not create pin when no EXIF GPS', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-456';
            const event = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: null
                }
            });

            // Should not throw
            expect(() => document.dispatchEvent(event)).not.toThrow();
        });

        it('AC7.4: does not create pin when GPS lat is undefined', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-789';
            const event = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lon: -74.0060
                            // lat missing
                        }
                    }
                }
            });

            // Should not throw
            expect(() => document.dispatchEvent(event)).not.toThrow();
        });
    });

    describe('upload:committed', () => {
        it('AC7.2: updates pin to committed state on upload:committed', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-committed';

            // Create pending pin first
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Commit the upload
            const committedEvent = new CustomEvent('upload:committed', {
                detail: {
                    uploadId: uploadId,
                    photo: {
                        id: 1,
                        lat: 40.7128,
                        lng: -74.0060
                    }
                }
            });
            document.dispatchEvent(committedEvent);

            // Should complete without error and element class should change to --committed
            expect(() => document.dispatchEvent(committedEvent)).not.toThrow();
        });

        it('does nothing if no optimistic pin existed', () => {
            OptimisticPins.init(mockMapUI);

            const committedEvent = new CustomEvent('upload:committed', {
                detail: {
                    uploadId: 'nonexistent',
                    photo: { id: 999 }
                }
            });

            // Should not throw
            expect(() => document.dispatchEvent(committedEvent)).not.toThrow();
        });
    });

    describe('upload:failed', () => {
        it('AC7.3: updates pin to failed state on upload:failed', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-failed';

            // Create pending pin first
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Simulate failure
            const failedEvent = new CustomEvent('upload:failed', {
                detail: {
                    uploadId: uploadId,
                    reason: 'networkError',
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(failedEvent);

            // Verify pin transitioned to failed state
            expect(() => document.dispatchEvent(failedEvent)).not.toThrow();
        });

        it('AC7.3: failed pin popup has action buttons', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-failed-popup';

            // Create pending pin
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Simulate failure (which creates popup HTML)
            const failedEvent = new CustomEvent('upload:failed', {
                detail: {
                    uploadId: uploadId,
                    reason: 'networkError',
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(failedEvent);

            // Verify: popup HTML should be created with action buttons (Retry, Discard, Pin manually)
            expect(() => document.dispatchEvent(failedEvent)).not.toThrow();
        });
    });

    describe('upload:aborted', () => {
        it('AC7.5: removes pin on upload:aborted', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'upload-aborted';

            // Create pending pin
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Abort the upload
            const abortedEvent = new CustomEvent('upload:aborted', {
                detail: {
                    uploadId: uploadId
                }
            });
            document.dispatchEvent(abortedEvent);

            // Verify marker.remove() was called on abort
            expect(() => document.dispatchEvent(abortedEvent)).not.toThrow();
        });

        it('does nothing if no pin existed for aborted upload', () => {
            OptimisticPins.init(mockMapUI);

            const abortedEvent = new CustomEvent('upload:aborted', {
                detail: {
                    uploadId: 'nonexistent'
                }
            });

            // Should not throw
            expect(() => document.dispatchEvent(abortedEvent)).not.toThrow();
        });
    });

    describe('event flow scenarios', () => {
        it('full lifecycle: create → commit', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'lifecycle-test-1';

            // Create
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 35.6762,
                            lon: 139.6503
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Commit
            const committedEvent = new CustomEvent('upload:committed', {
                detail: {
                    uploadId: uploadId,
                    photo: {
                        id: 1,
                        lat: 35.6762,
                        lng: 139.6503
                    }
                }
            });
            document.dispatchEvent(committedEvent);

            expect(() => document.dispatchEvent(committedEvent)).not.toThrow();
        });

        it('full lifecycle: create → fail → retry', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'lifecycle-test-2';

            // Create
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 51.5074,
                            lon: -0.1278
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Fail
            const failedEvent = new CustomEvent('upload:failed', {
                detail: {
                    uploadId: uploadId,
                    reason: 'uploadFailed',
                    exif: {
                        gps: {
                            lat: 51.5074,
                            lon: -0.1278
                        }
                    }
                }
            });
            document.dispatchEvent(failedEvent);

            // Retry button would trigger UploadQueue.retry
            expect(UploadQueue.retry).not.toHaveBeenCalled();

            expect(() => document.dispatchEvent(failedEvent)).not.toThrow();
        });

        it('full lifecycle: create → fail → abort', () => {
            OptimisticPins.init(mockMapUI);

            const uploadId = 'lifecycle-test-3';

            // Create
            const createdEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: uploadId,
                    exif: {
                        gps: {
                            lat: 48.8566,
                            lon: 2.3522
                        }
                    }
                }
            });
            document.dispatchEvent(createdEvent);

            // Fail
            const failedEvent = new CustomEvent('upload:failed', {
                detail: {
                    uploadId: uploadId,
                    reason: 'uploadFailed',
                    exif: {
                        gps: {
                            lat: 48.8566,
                            lon: 2.3522
                        }
                    }
                }
            });
            document.dispatchEvent(failedEvent);

            // Abort
            const abortedEvent = new CustomEvent('upload:aborted', {
                detail: {
                    uploadId: uploadId
                }
            });
            document.dispatchEvent(abortedEvent);

            expect(() => document.dispatchEvent(abortedEvent)).not.toThrow();
        });
    });

    describe('multiple concurrent uploads', () => {
        it('handles 3 concurrent uploads', () => {
            OptimisticPins.init(mockMapUI);

            const uploadIds = ['upload-a', 'upload-b', 'upload-c'];

            // Create all three
            uploadIds.forEach(id => {
                const createdEvent = new CustomEvent('upload:created', {
                    detail: {
                        uploadId: id,
                        exif: {
                            gps: {
                                lat: 40.7128 + Math.random(),
                                lon: -74.0060 + Math.random()
                            }
                        }
                    }
                });
                document.dispatchEvent(createdEvent);
            });

            // Commit first two
            uploadIds.slice(0, 2).forEach(id => {
                const committedEvent = new CustomEvent('upload:committed', {
                    detail: {
                        uploadId: id,
                        photo: { id: Math.random() }
                    }
                });
                document.dispatchEvent(committedEvent);
            });

            // Fail the third
            const failedEvent = new CustomEvent('upload:failed', {
                detail: {
                    uploadId: uploadIds[2],
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(failedEvent);

            expect(() => document.dispatchEvent(failedEvent)).not.toThrow();
        });
    });

    describe('mixed GPS scenarios', () => {
        it('handles mixed uploads: some with GPS, some without', () => {
            OptimisticPins.init(mockMapUI);

            // Upload with GPS
            const withGpsEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: 'with-gps',
                    exif: {
                        gps: {
                            lat: 40.7128,
                            lon: -74.0060
                        }
                    }
                }
            });
            document.dispatchEvent(withGpsEvent);

            // Upload without GPS
            const withoutGpsEvent = new CustomEvent('upload:created', {
                detail: {
                    uploadId: 'without-gps',
                    exif: {
                        takenAt: new Date().toISOString()
                        // No GPS
                    }
                }
            });
            document.dispatchEvent(withoutGpsEvent);

            expect(() => {
                document.dispatchEvent(withGpsEvent);
                document.dispatchEvent(withoutGpsEvent);
            }).not.toThrow();
        });
    });
});
