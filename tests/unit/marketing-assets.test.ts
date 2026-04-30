import { describe, it, expect } from 'vitest';
import { statSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Marketing assets', () => {
  const publicDir = resolve(__dirname, '..', '..', 'public');
  const assets = [
    'collections.jpg',
    'expanded.jpg',
    'dataviewer.jpg',
    'tradeuptable.jpg',
  ];
  const deletedAssets = [
    'collections.png',
    'expanded.png',
    'dataviewer.png',
    'tradeuptable.png',
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
