import { describe, it, expect, beforeEach } from 'vitest';

describe('FeatureFlags', () => {
  beforeEach(() => {
    // Clear the DOM between tests
    document.body.innerHTML = '';
  });

  describe('isEnabled', () => {
    it('returns false when meta tag is missing', () => {
      // No meta tag at all
      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(false);
    });

    it('returns false when the feature flag attribute is missing', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(false);
    });

    it('returns true when flag is set to "true"', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.resilientUploadsUi = 'true';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(true);
    });

    it('returns true when flag is set to "True" (capitalized)', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.resilientUploadsUi = 'True';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(true);
    });

    it('returns false when flag is set to "false"', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.resilientUploadsUi = 'false';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(false);
    });

    it('returns false when flag is set to any other value', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.resilientUploadsUi = '1';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(false);
    });

    it('converts camelCase input to the correct data attribute key', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.someFeatureFlag = 'true';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('some-feature-flag')).toBe(true);
    });

    it('handles multiple feature flags independently', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.resilientUploadsUi = 'true';
      meta.dataset.someOtherFlag = 'false';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('resilient-uploads-ui')).toBe(true);
      expect(FeatureFlags.isEnabled('some-other-flag')).toBe(false);
    });

    it('converts kebab-case to camelCase correctly (e.g., "foo-bar-baz" -> "fooBarBaz")', () => {
      const meta = document.createElement('meta');
      meta.id = 'featureFlags';
      meta.dataset.fooBarBaz = 'true';
      document.head.appendChild(meta);

      expect(FeatureFlags.isEnabled('foo-bar-baz')).toBe(true);
    });
  });
});
