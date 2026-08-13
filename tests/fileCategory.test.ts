import { test } from 'node:test';
import assert from 'node:assert';
import {
  getFileCategory,
  getFileTypeInfo,
  splitFileName,
  isImageFile,
  isBrowserDecodableImage,
  getImageMime,
} from '../src/shared/fileCategory';

test('getFileCategory buckets by extension', () => {
  assert.strictEqual(getFileCategory('photo.png'), 'image');
  assert.strictEqual(getFileCategory('movie.mp4'), 'video');
  assert.strictEqual(getFileCategory('song.mp3'), 'audio');
  assert.strictEqual(getFileCategory('report.pdf'), 'document');
  assert.strictEqual(getFileCategory('sheet.xlsx'), 'document'); // spreadsheet → document
  assert.strictEqual(getFileCategory('deck.pptx'), 'document'); // presentation → document
  assert.strictEqual(getFileCategory('archive.zip'), 'other');
  assert.strictEqual(getFileCategory('noextension'), 'other');
  assert.strictEqual(getFileCategory('UPPER.PNG'), 'image'); // case-insensitive
});

test('getFileTypeInfo returns rich category for known extensions', () => {
  assert.strictEqual(getFileTypeInfo('app.js').category, 'code');
  assert.strictEqual(getFileTypeInfo('main.py').category, 'code');
  assert.strictEqual(getFileTypeInfo('db.sqlite3').category, 'database');
  assert.strictEqual(getFileTypeInfo('font.woff2').category, 'font');
  assert.strictEqual(getFileTypeInfo('setup.exe').category, 'executable');
  assert.strictEqual(getFileTypeInfo('unknown.xyz').category, 'other');
  assert.strictEqual(getFileTypeInfo('').category, 'other');
  // quirk: 'ts' is ambiguous (MPEG-TS video vs TypeScript) — video wins today
  assert.strictEqual(getFileTypeInfo('clip.ts').category, 'video');
});

test('splitFileName keeps the extension on the right side', () => {
  assert.deepStrictEqual(splitFileName('photo.png'), { base: 'photo', ext: '.png' });
  assert.deepStrictEqual(splitFileName('archive.tar.gz'), { base: 'archive.tar', ext: '.gz' });
  assert.deepStrictEqual(splitFileName('noextension'), { base: 'noextension', ext: '' });
  assert.deepStrictEqual(splitFileName('a.b.c'), { base: 'a.b', ext: '.c' });
});

test('isImageFile / isBrowserDecodableImage / getImageMime', () => {
  assert.strictEqual(isImageFile('a.jpg'), true);
  assert.strictEqual(isImageFile('a.pdf'), false);
  assert.strictEqual(isBrowserDecodableImage('a.png'), true);
  assert.strictEqual(isBrowserDecodableImage('a.tiff'), false); // not browser-decodable
  assert.strictEqual(getImageMime('a.jpg'), 'image/jpeg');
  assert.strictEqual(getImageMime('a.svg'), 'image/svg+xml');
  assert.strictEqual(getImageMime('a.pdf'), null);
});
