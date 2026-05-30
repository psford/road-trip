import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();

/**
 * iOS Safe Area Tests
 *
 * Static file-content assertions (no DOM, no eval) for:
 * 1. viewport-fit=cover meta tags in all wwwroot HTML files
 * 2. Safe-area CSS rules in ios.css scoped under .platform-ios
 *
 * These tests verify that the structure is in place so that:
 * - AC6.safeArea.1: viewport-fit=cover enables env(safe-area-inset-*) on iOS
 * - AC6.safeArea.2-4: CSS rules properly account for notched iPhones and home indicators
 */

describe('iOS Safe Area (static file assertions)', () => {
  describe('AC6.safeArea.1: viewport-fit=cover in every wwwroot HTML', () => {
    const htmlFiles = [
      'src/RoadTripMap/wwwroot/index.html',
      'src/RoadTripMap/wwwroot/create.html',
      'src/RoadTripMap/wwwroot/post.html',
      'src/RoadTripMap/wwwroot/trips.html',
    ];

    htmlFiles.forEach((filePath) => {
      it(`${filePath} contains viewport-fit=cover`, () => {
        const content = fs.readFileSync(path.join(projectRoot, filePath), 'utf8');
        expect(content).toContain('viewport-fit=cover');
      });

      it(`${filePath} has exact viewport meta string`, () => {
        const content = fs.readFileSync(path.join(projectRoot, filePath), 'utf8');
        expect(content).toContain(
          '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'
        );
      });
    });

    it('bootstrap index.html is NOT modified (already has viewport-fit=cover from Capacitor)', () => {
      const bootstrapPath = path.join(projectRoot, 'src/bootstrap/index.html');
      if (fs.existsSync(bootstrapPath)) {
        const content = fs.readFileSync(bootstrapPath, 'utf8');
        // This file should already have viewport-fit=cover from the Capacitor baseline
        // We just verify it exists and doesn't get added again
        expect(content).toContain('viewport-fit=cover');
      }
    });
  });

  describe('AC6.safeArea.2: top-inset rules with .platform-ios scope', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    // `.platform-ios .page-header` deliberately omitted: capacitor.config.js sets
    // ios.contentInset: "always", which pushes content below the device safe-area
    // at the WebView layer. Adding env(safe-area-inset-top) on top of that on a
    // sticky-positioned header double-counts the notch and produces a visible
    // empty gap above the header (observed iPhone 16 Pro, 2026-05-13). The
    // page-header rule now uses a design-token-only padding-top; the WebView's
    // content inset handles the safe-area.
    const topInsetSelectors = [
      '.platform-ios .map-header',
      '.platform-ios .hero',
      '.platform-ios .resume-banner',
    ];

    topInsetSelectors.forEach((selector) => {
      it(`${selector} selector exists in ios.css`, () => {
        expect(content).toContain(selector);
      });

      it(`${selector} rule contains padding-top and env(safe-area-inset-top)`, () => {
        const regex = new RegExp(
          `${selector.replace(/\./g, '\\.')}[^}]*padding-top:[^}]*env\\(safe-area-inset-top\\)`,
          's'
        );
        expect(content).toMatch(regex);
      });
    });

    it('.platform-ios .pinned-stack uses padding-top: env(safe-area-inset-top)', () => {
      // Scroll-fade Task 8 (2026-05-30): Position sticky moved from .page-header to
      // .pinned-stack, which uses fixed positioning (Task 9 HTML restructure). The
      // pinned-stack carries the safe-area padding that was previously on the sticky
      // pin point. env(safe-area-inset-top) ensures the header sits below the status
      // bar / Dynamic Island on notched devices, and falls back to 0 on devices without
      // a notch.
      const ruleMatch = content.match(
        /\.platform-ios \.pinned-stack\s*\{[^}]*?padding-top:\s*env\(safe-area-inset-top[^}]*\}/s
      );
      expect(ruleMatch, '.platform-ios .pinned-stack rule with padding-top: env(safe-area-inset-top) not found').not.toBeNull();
      expect(ruleMatch[0]).toMatch(/padding-top:\s*env\(safe-area-inset-top/);
    });

    it('ios.css contains at least 6 env(safe-area-inset-top) declarations (3 top-inset + 1 modal + 1 pinned-stack + 1 resume-banner)', () => {
      // Scroll-fade Task 8: .pinned-stack now carries env(safe-area-inset-top) on
      // padding-top. With 3 top-inset rules + 1 modal + 1 pinned-stack + 1 resume-banner,
      // the floor is at least 6.
      const matches = content.match(/env\(safe-area-inset-top\)/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('AC6.safeArea.3: bottom-inset rules with .platform-ios scope', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    it('.platform-ios .toast-container selector exists', () => {
      expect(content).toContain('.platform-ios .toast-container');
    });

    it('.platform-ios .toast-container rule contains bottom and env(safe-area-inset-bottom)', () => {
      const regex = /\.platform-ios \.toast-container[^}]*bottom:[^}]*env\(safe-area-inset-bottom\)/s;
      expect(content).toMatch(regex);
    });

    it('.platform-ios .view-carousel-container selector exists', () => {
      expect(content).toContain('.platform-ios .view-carousel-container');
    });

    it('.platform-ios .view-carousel-container rule contains padding-bottom and env(safe-area-inset-bottom)', () => {
      const regex = /\.platform-ios \.view-carousel-container[^}]*padding-bottom:[^}]*env\(safe-area-inset-bottom\)/s;
      expect(content).toMatch(regex);
    });

    it('.platform-ios .map-control selector exists', () => {
      expect(content).toContain('.platform-ios .map-control');
    });

    it('.platform-ios .map-control rule contains bottom and env(safe-area-inset-bottom)', () => {
      const regex = /\.platform-ios \.map-control[^}]*bottom:[^}]*env\(safe-area-inset-bottom\)/s;
      expect(content).toMatch(regex);
    });

    it('ios.css contains at least 4 env(safe-area-inset-bottom) declarations (3 bottom-inset + 1 modal)', () => {
      const matches = content.match(/env\(safe-area-inset-bottom\)/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('AC6.safeArea.4: modal overlay has both top and bottom insets', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    it('.platform-ios .homescreen-modal-overlay selector exists', () => {
      expect(content).toContain('.platform-ios .homescreen-modal-overlay');
    });

    it('.homescreen-modal-overlay rule contains padding-top with env(safe-area-inset-top)', () => {
      const regex = /\.platform-ios \.homescreen-modal-overlay[^}]*padding-top:[^}]*env\(safe-area-inset-top\)/s;
      expect(content).toMatch(regex);
    });

    it('.homescreen-modal-overlay rule contains padding-bottom with env(safe-area-inset-bottom)', () => {
      const regex = /\.platform-ios \.homescreen-modal-overlay[^}]*padding-bottom:[^}]*env\(safe-area-inset-bottom\)/s;
      expect(content).toMatch(regex);
    });

    it('.homescreen-modal-overlay rule contains both top and bottom in same block', () => {
      // Extract the .homescreen-modal-overlay rule block
      const regex = /\.platform-ios \.homescreen-modal-overlay\s*\{[^}]+\}/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const ruleBlock = match[0];
        expect(ruleBlock).toContain('padding-top:');
        expect(ruleBlock).toContain('env(safe-area-inset-top)');
        expect(ruleBlock).toContain('padding-bottom:');
        expect(ruleBlock).toContain('env(safe-area-inset-bottom)');
      }
    });
  });

  describe('Regression: no unscoped selectors in Phase 6 block', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    it('every selector starting with . after Phase 6 comment begins with .platform-ios', () => {
      // Find the Phase 6 section comment
      const phase6StartIndex = content.indexOf('* Phase 6: safe-area insets');
      expect(phase6StartIndex).toBeGreaterThan(-1);

      const phase6Section = content.substring(phase6StartIndex);

      // Strip out multi-line comment blocks before parsing selectors
      const withoutComments = phase6Section
        .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove /* ... */ blocks

      // Extract all lines that start with . (selector lines)
      const selectorLines = withoutComments
        .split('\n')
        .filter((line) => line.trim().startsWith('.'));

      // Each selector line should start with .platform-ios
      selectorLines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed) {
          expect(trimmed).toMatch(/^\.platform-ios/);
        }
      });
    });
  });
});
