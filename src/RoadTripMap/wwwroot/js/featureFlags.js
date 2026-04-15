/**
 * FeatureFlags — Global feature flag mechanism
 *
 * Reads feature flags from a server-rendered meta tag:
 *   <meta id="featureFlags" data-resilient-uploads-ui="true" data-other-flag="false">
 *
 * Usage:
 *   if (FeatureFlags.isEnabled('resilient-uploads-ui')) { ... }
 */
const FeatureFlags = (() => {
  const toBool = (v) => v === 'true' || v === 'True';

  return {
    /**
     * Check if a feature flag is enabled.
     * @param {string} camelCaseName - Feature name in kebab-case (e.g., 'resilient-uploads-ui')
     * @returns {boolean} - true if flag is set to 'true' or 'True', false otherwise
     */
    isEnabled(camelCaseName) {
      // Lazily read the meta tag each time (allows tests to inject it after module load)
      const node = document.getElementById('featureFlags');
      const ds = node?.dataset ?? {};

      // Convert kebab-case to camelCase for dataset property access
      // e.g., 'resilient-uploads-ui' -> 'resilientUploadsUi'
      const key = camelCaseName.replace(/-./g, c => c.charAt(1).toUpperCase());
      return toBool(ds[key]);
    }
  };
})();
