import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();

/**
 * iOS HIG Compliance Tests
 *
 * Static file-content assertions (no DOM, no eval) for:
 * 1. Consolidated 44×44 tap-target rule covering all HIG-audit selectors
 * 2. Momentum scrolling on .upload-panel__body
 * 3. iOS keyboard attributes on form inputs
 * 4. Regular-browser invariance (all selectors scoped under .platform-ios)
 *
 * These tests verify that the structure is in place so that:
 * - AC6.hig.1: All critical buttons have ≥44×44pt hit zones
 * - AC6.hig.2: Upload list scrolls with iOS momentum
 * - AC6.hig.3: Caption input has autocorrect + autocapitalize
 * - AC6.hig.4: Trip name / description have correct autocapitalize values
 * - AC6.hig.5: Non-iOS browsers see no visible change
 */

describe('iOS HIG Compliance (static file assertions)', () => {
  describe('AC6.hig.1: tap-target 44×44 rule contains all required selectors', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    const requiredSelectors = [
      '.platform-ios .upload-panel__retry',
      '.platform-ios .upload-panel__pin-drop',
      '.platform-ios .upload-panel__discard',
      '.platform-ios .upload-panel__toggle',
      '.platform-ios .carousel-action-btn',
      '.platform-ios .photo-popup-delete',
      '.platform-ios .copy-button',
      '.platform-ios .map-back',
      '.platform-ios .poi-action-btn',
    ];

    requiredSelectors.forEach((selector) => {
      it(`ios.css contains selector ${selector}`, () => {
        expect(content).toContain(selector);
      });
    });

    it('44×44 rule contains min-height: 44px', () => {
      // Find the consolidated tap-target rule by searching for the first selector
      // and verifying the rule block contains both min-height and min-width
      const regex = /\.platform-ios \.upload-panel__retry[^}]*min-height: 44px[^}]*min-width: 44px/s;
      expect(content).toMatch(regex);
    });

    it('44×44 rule contains min-width: 44px', () => {
      const regex = /\.platform-ios \.upload-panel__retry[^}]*min-width: 44px/s;
      expect(content).toMatch(regex);
    });

    it('padding-widening rule exists for upload-panel action buttons', () => {
      // Check for a rule with .upload-panel__retry (or pin-drop/discard) and padding >= 12px on each axis
      const regex = /\.platform-ios \.upload-panel__retry[^}]*padding:\s*(\d+)px\s+(\d+)px/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const vertPadding = parseInt(match[1], 10);
        const horizPadding = parseInt(match[2], 10);
        expect(vertPadding).toBeGreaterThanOrEqual(12);
        expect(horizPadding).toBeGreaterThanOrEqual(12);
      }
    });
  });

  describe('AC6.hig.2: momentum scrolling on .upload-panel__body', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    it('ios.css contains -webkit-overflow-scrolling: touch', () => {
      expect(content).toContain('-webkit-overflow-scrolling: touch');
    });

    it('-webkit-overflow-scrolling rule is in a block with .platform-ios .upload-panel__body selector', () => {
      const regex = /\.platform-ios \.upload-panel__body[^}]*-webkit-overflow-scrolling: touch/s;
      expect(content).toMatch(regex);
    });
  });

  describe('AC6.hig.3: #captionInput has iOS keyboard attributes', () => {
    const postHtmlPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/post.html');
    const content = fs.readFileSync(postHtmlPath, 'utf8');

    it('post.html contains <input id="captionInput"', () => {
      expect(content).toContain('id="captionInput"');
    });

    it('captionInput tag contains autocorrect="on"', () => {
      // Extract the captionInput tag (from id= to the closing >)
      const regex = /id="captionInput"[^>]*>/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const tag = match[0];
        expect(tag).toContain('autocorrect="on"');
      }
    });

    it('captionInput tag contains autocapitalize="sentences"', () => {
      const regex = /id="captionInput"[^>]*>/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const tag = match[0];
        expect(tag).toContain('autocapitalize="sentences"');
      }
    });
  });

  describe('AC6.hig.4: trip name and description have correct autocapitalize', () => {
    const createHtmlPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/create.html');
    const content = fs.readFileSync(createHtmlPath, 'utf8');

    it('create.html #tripName input contains autocapitalize="words"', () => {
      const regex = /id="tripName"[^>]*>/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const tag = match[0];
        expect(tag).toContain('autocapitalize="words"');
      }
    });

    it('create.html #tripDescription textarea contains autocapitalize="sentences"', () => {
      const regex = /id="tripDescription"[^>]*>/s;
      const match = content.match(regex);
      expect(match).toBeTruthy();

      if (match) {
        const tag = match[0];
        expect(tag).toContain('autocapitalize="sentences"');
      }
    });
  });

  describe('AC6.hig.5: regular-browser invariance (all Phase 7 selectors scoped)', () => {
    const iosCssPath = path.join(projectRoot, 'src/RoadTripMap/wwwroot/ios.css');
    const content = fs.readFileSync(iosCssPath, 'utf8');

    it('every selector starting with . in Phase 7 section begins with .platform-ios', () => {
      // Find the start of the consolidated tap-target rule (Phase 7 starts around line 24)
      // We'll scan from the existing "Tap target minimums" comment forward to EOF
      const phase7StartIndex = content.indexOf('/* ---- Tap target minimums (Apple HIG: 44x44 pt) ---- */');
      expect(phase7StartIndex).toBeGreaterThan(-1);

      const phase7Section = content.substring(phase7StartIndex);

      // Extract all lines that start with . (selector lines, skipping comments and properties)
      const selectorLines = phase7Section
        .split('\n')
        .filter((line) => line.trim().startsWith('.'));

      // Each selector line should start with .platform-ios
      selectorLines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('/*')) {
          expect(trimmed).toMatch(/^\.platform-ios/);
        }
      });
    });
  });
});
