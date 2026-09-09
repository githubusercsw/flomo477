// 用 jsdom 提供 DOM，用内存 chrome API 提供扩展环境，运行 src/ 下的**真实源码**。
// jsdom 用裸导入：Node 会向上查找 /data/workspace/node_modules，比硬编码全局路径稳定
// （沙盒里 npm 全局包会被其他安装操作清掉，硬编码绝对路径会突然失效）
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

export const SRC = '/data/workspace/flomo-extension/src';

let importSeq = 0;

/** 安装一个页面环境：替换 globalThis 的 window/document/chrome，使其可被 UI 模块直接使用 */
export function mountPage(htmlFile, chrome, opts = {}) {
  const file = path.join(SRC, 'ui', htmlFile);
  const html = fs.readFileSync(file, 'utf8');
  const dom = new JSDOM(html, {
    // outside-only：允许我们手动 eval content script，但不自动执行页面里的 module 脚本
    runScripts: 'outside-only',
    url: opts.url || 'chrome-extension://mock-extension-id/' + htmlFile,
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = chrome;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  return dom;
}

/** 导入真实 UI 模块（加 query 绕过 ESM 缓存，保证每次重新执行） */
export async function runUiModule(relPath) {
  const url = path.join(SRC, 'ui', relPath) + '?v=' + ++importSeq;
  return import(url);
}

/** 导入真实后台模块 */
export async function runBackground(relPath) {
  const url = path.join(SRC, 'background', relPath) + '?v=' + ++importSeq;
  return import(url);
}

/** 在页面上下文执行 classic content script（IIFE，无 import） */
export function runContentScript(dom, chrome) {
  const code = fs.readFileSync(path.join(SRC, 'content', 'index.js'), 'utf8');
  dom.window.chrome = chrome;
  dom.window.eval(code);
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
