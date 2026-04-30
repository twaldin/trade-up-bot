
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const publicDir = path.resolve(process.cwd(), 'public');
const imageAssets = [
  'collections',
  'expanded',
  'dataviewer',
  'tradeuptable',
];

describe('Marketing Assets', () => {
  imageAssets.forEach((asset) => {
    const jpgPath = path.join(publicDir, `${asset}.jpg`);
    const pngPath = path.join(publicDir, `${asset}.png`);

    it(`${asset}.jpg should exist and be less than 500KB`, () => {
      expect(fs.existsSync(jpgPath)).toBe(true);
      const stats = fs.statSync(jpgPath);
      expect(stats.size).toBeLessThan(500_000);
    });

    it(`${asset}.png should not exist`, () => {
      expect(fs.existsSync(pngPath)).toBe(false);
    });
  });
});
