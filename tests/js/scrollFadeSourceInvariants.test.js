import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const wwwroot = resolve(process.cwd(), 'src/RoadTripMap/wwwroot');

describe('scroll-fade source invariants', () => {
  it('styles.css does not use the light-dark() function (AC2.4)', () => {
    const css = readFileSync(resolve(wwwroot, 'css/styles.css'), 'utf-8');
    expect(css).not.toMatch(/light-dark\s*\(/);
  });

  it('ios.css does not use the light-dark() function (AC2.4)', () => {
    const css = readFileSync(resolve(wwwroot, 'ios.css'), 'utf-8');
    expect(css).not.toMatch(/light-dark\s*\(/);
  });

  it('ios.css has no position: sticky inside any .platform-ios .page-header rule (AC5.1)', () => {
    const css = readFileSync(resolve(wwwroot, 'ios.css'), 'utf-8');
    // Scope: each .platform-ios .page-header rule body (between { and })
    const ruleBlocks = css.match(/\.platform-ios\s+\.page-header[^{]*\{[^}]*\}/g) || [];
    for (const block of ruleBlocks) {
      expect(block).not.toMatch(/position\s*:\s*-webkit-sticky/);
      expect(block).not.toMatch(/position\s*:\s*sticky/);
    }
  });

  it('ios.css .platform-ios .pinned-stack has env(safe-area-inset-top, 0px) (AC5.2)', () => {
    const css = readFileSync(resolve(wwwroot, 'ios.css'), 'utf-8');
    const ruleBlocks = css.match(/\.platform-ios\s+\.pinned-stack[^{]*\{[^}]*\}/g) || [];
    expect(ruleBlocks.length).toBeGreaterThanOrEqual(1);
    const hasSafeArea = ruleBlocks.some((b) => /padding-top\s*:\s*env\(safe-area-inset-top,\s*0px\)/.test(b));
    expect(hasSafeArea).toBe(true);
  });

  it('capacitor.config.js ios.contentInset is "automatic" (AC5.3)', () => {
    // Path from repo root.
    const cfg = readFileSync(resolve(process.cwd(), 'capacitor.config.js'), 'utf-8');
    expect(cfg).toMatch(/contentInset\s*:\s*['"]automatic['"]/);
  });

  // AC7.3 ("no prefers-reduced-motion media queries are ADDED in this design")
  // is a forbid-NEW invariant, not forbid-ANY. The codebase already contains
  // a prefers-reduced-motion block in styles.css (skeleton-shimmer override,
  // pre-existing from ios-shell-polish) and one in ios.css (animation-duration
  // override). A static regex can't distinguish "this PR's additions" from
  // baseline. Verification of AC7.3 therefore lives in PR review: reviewer
  // confirms no new @media (prefers-reduced-motion) blocks appear in the diff.
  // No assertion in this test file.

  it('index.html does not have a .pinned-stack or .scroll-content (AC7.1)', () => {
    const html = readFileSync(resolve(wwwroot, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/class="[^"]*\bpinned-stack\b/);
    expect(html).not.toMatch(/class="[^"]*\bscroll-content\b/);
  });

  it('trips.html does not have a .pinned-stack or .scroll-content (AC7.2)', () => {
    const html = readFileSync(resolve(wwwroot, 'trips.html'), 'utf-8');
    expect(html).not.toMatch(/class="[^"]*\bpinned-stack\b/);
    expect(html).not.toMatch(/class="[^"]*\bscroll-content\b/);
  });
});
