import { describe, it, expect } from 'vitest';
import { statSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Marketing assets', () => {
  const publicDir = resolve(__dirname, '..', '..', 'public');

  // Optimised responsive variants that are actively referenced by LandingPage
  const assets = [
    'tradeuptable.jpg',
  ];

  // Original full-size images deleted in plan-004 (unreferenced, >100 KB each).
  // Responsive srcset variants (collections-*w, dataviewer-*w, expanded-*w) are kept.
  const deletedAssets = [
    'collections.png',
    'expanded.png',
    'dataviewer.png',
    'tradeuptable.png',
    // Originals removed in plan-004 (zero code refs, >100 KB)
    'collections.jpg',
    'expanded.jpg',
    'dataviewer.jpg',
    'dreams&nightmares-collection.png',
  ];
  const maxSize = 500_000;

  for (const asset of assets) {
    it(`${asset} should exist and be less than ${maxSize} bytes`, () => {
      const assetPath = resolve(publicDir, asset);
      const stats = statSync(assetPath);
      expect(stats.size).toBeLessThan(maxSize);
    });
  }

  for (const asset of deletedAssets) {
    it(`${asset} should not exist`, () => {
      const assetPath = resolve(publicDir, asset);
      expect(existsSync(assetPath)).toBe(false);
    });
  }
});
