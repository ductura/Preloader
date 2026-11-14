import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOs, detectBrowser, isMobile, chooseFrontend, desktopPackageFor } from '../src/detect.js';
import { UA } from './user-agents.js';

test('detectOs', () => {
  assert.equal(detectOs(UA.chromeMac), 'macos');
  assert.equal(detectOs(UA.chromeWindows), 'windows');
  assert.equal(detectOs(UA.chromeAndroid), 'android');
  assert.equal(detectOs(UA.safariIphone), 'ios');
  assert.equal(detectOs(UA.firefoxLinux), 'linux');
  assert.equal(detectOs(''), 'other');
});

test('detectBrowser razlikuje Edge i Operu od Chromea', () => {
  assert.equal(detectBrowser(UA.chromeMac), 'chrome');
  assert.equal(detectBrowser(UA.edgeWindows), 'edge');
  assert.equal(detectBrowser(UA.operaWindows), 'opera');
  assert.equal(detectBrowser(UA.firefoxLinux), 'firefox');
  assert.equal(detectBrowser(UA.safariMac), 'safari');
});

test('isMobile', () => {
  assert.equal(isMobile(UA.chromeAndroid), true);
  assert.equal(isMobile(UA.safariIphone), true);
  assert.equal(isMobile(UA.chromeMac), false);
});

test('chooseFrontend', () => {
  assert.equal(chooseFrontend(UA.chromeWindows), 'chrome');
  assert.equal(chooseFrontend(UA.edgeWindows), 'other');
  assert.equal(chooseFrontend(UA.safariMac), 'other');
  assert.equal(chooseFrontend(UA.safariIphone), 'mobile');
});

test('desktopPackageFor nudi paket samo na Windowsu i macOS-u', () => {
  assert.equal(desktopPackageFor(UA.chromeWindows), 'windows');
  assert.equal(desktopPackageFor(UA.safariMac), 'macos');
  assert.equal(desktopPackageFor(UA.firefoxLinux), null);
  assert.equal(desktopPackageFor(UA.chromeAndroid), null);
});
