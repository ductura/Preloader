import { describe, expect, test } from 'vitest';
import { chooseFrontend, desktopPackageFor, detectBrowser, detectOs, isMobile } from '../src/detect.ts';
import { UA } from './user-agents.ts';

describe('detectOs', () => {
  test.each([
    [UA.chromeMac, 'macos'],
    [UA.chromeWindows, 'windows'],
    [UA.chromeAndroid, 'android'],
    [UA.safariIphone, 'ios'],
    [UA.firefoxLinux, 'linux'],
    ['', 'other'],
  ])('%s', (ua, os) => expect(detectOs(ua)).toBe(os));
});

describe('detectBrowser razlikuje Edge i Operu od Chromea', () => {
  test.each([
    [UA.chromeMac, 'chrome'],
    [UA.edgeWindows, 'edge'],
    [UA.operaWindows, 'opera'],
    [UA.firefoxLinux, 'firefox'],
    [UA.safariMac, 'safari'],
    ['', 'other'],
  ])('%s', (ua, browser) => expect(detectBrowser(ua)).toBe(browser));
});

test('isMobile', () => {
  expect(isMobile(UA.chromeAndroid)).toBe(true);
  expect(isMobile(UA.safariIphone)).toBe(true);
  expect(isMobile(UA.chromeMac)).toBe(false);
});

test('chooseFrontend', () => {
  expect(chooseFrontend(UA.chromeWindows)).toBe('web');
  expect(chooseFrontend(UA.edgeWindows)).toBe('web');
  expect(chooseFrontend(UA.safariMac)).toBe('web');
  expect(chooseFrontend(UA.safariIphone)).toBe('mobile');
});

test('desktopPackageFor nudi paket samo na Windowsu i macOS-u', () => {
  expect(desktopPackageFor(UA.chromeWindows)).toBe('windows');
  expect(desktopPackageFor(UA.safariMac)).toBe('macos');
  expect(desktopPackageFor(UA.firefoxLinux)).toBeNull();
  expect(desktopPackageFor(UA.chromeAndroid)).toBeNull();
});
