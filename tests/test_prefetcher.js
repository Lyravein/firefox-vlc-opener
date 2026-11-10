const assert = require("assert");

// Mock WebExtensions environment for prefetcher logic test
class MockTabs {
  constructor() {
    this.tabs = new Map();
    this.nextId = 100;
    this.onUpdated = {
      listeners: new Set(),
      addListener(fn) { this.listeners.add(fn); },
      removeListener(fn) { this.listeners.delete(fn); },
      emit(tabId, changeInfo) { for (const fn of this.listeners) fn(tabId, changeInfo); }
    };
    this.onRemoved = {
      listeners: new Set(),
      addListener(fn) { this.listeners.add(fn); },
      removeListener(fn) { this.listeners.delete(fn); },
      emit(tabId) { for (const fn of this.listeners) fn(tabId); }
    };
  }

  async create(opts) {
    const id = this.nextId++;
    const tab = { id, url: opts.url, active: Boolean(opts.active), muted: false };
    this.tabs.set(id, tab);
    return tab;
  }

  async update(id, props) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error("Tab not found");
    Object.assign(tab, props);
    return tab;
  }

  async remove(id) {
    this.tabs.delete(id);
    this.onRemoved.emit(id);
  }
}

class MockScripting {
  constructor() {
    this.executed = [];
  }
  async executeScript(args) {
    this.executed.push(args);
    return [{ result: null }];
  }
}

// Minimal prefetcher logic runner matching extension/background.js implementation
function createPrefetcher(browserMock, trackerMock) {
  let activePrefetchJob = null;
  const tabStreamResolvers = new Map();

  function onHeadersReceived(details) {
    const recorded = trackerMock.recordResponse(details.requestId, details.tabId, details.url, details.statusCode, details.responseHeaders);
    if (recorded && details.tabId >= 0) {
      const resolver = tabStreamResolvers.get(details.tabId);
      if (resolver) {
        tabStreamResolvers.delete(details.tabId);
        resolver(trackerMock.getBestStream(details.tabId));
      }
    }
  }

  async function prefetchNextEpisodeStream(nextEpisodeUrl, timeoutMs = 200) {
    if (activePrefetchJob) return null;
    activePrefetchJob = nextEpisodeUrl;
    let tab = null;
    let onUpdatedListener = null;
    let onRemovedListener = null;
    let timer = null;

    try {
      tab = await browserMock.tabs.create({ url: nextEpisodeUrl, active: false });
      await browserMock.tabs.update(tab.id, { muted: true }).catch(() => {});

      const existing = trackerMock.getBestStream(tab.id);
      if (existing) return existing;

      onUpdatedListener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === "complete") {
          browserMock.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => {}
          }).catch(() => {});
        }
      };
      browserMock.tabs.onUpdated.addListener(onUpdatedListener);

      onRemovedListener = (tabId) => {
        if (tabId === tab.id) {
          const r = tabStreamResolvers.get(tab.id);
          if (r) {
            tabStreamResolvers.delete(tab.id);
            r(null);
          }
        }
      };
      browserMock.tabs.onRemoved.addListener(onRemovedListener);

      const streamPromise = new Promise((resolve) => {
        tabStreamResolvers.set(tab.id, resolve);
      });
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
          tabStreamResolvers.delete(tab.id);
          resolve(null);
        }, timeoutMs);
      });

      const stream = await Promise.race([streamPromise, timeoutPromise]);
      clearTimeout(timer);
      return stream;
    } finally {
      if (onUpdatedListener) browserMock.tabs.onUpdated.removeListener(onUpdatedListener);
      if (onRemovedListener) browserMock.tabs.onRemoved.removeListener(onRemovedListener);
      if (tab && tab.id) {
        await browserMock.tabs.remove(tab.id).catch(() => {});
        trackerMock.cleanupTab(tab.id);
      }
      activePrefetchJob = null;
    }
  }

  return { prefetchNextEpisodeStream, onHeadersReceived, tabStreamResolvers };
}

async function testSuccessfulCapture() {
  const tabs = new MockTabs();
  const scripting = new MockScripting();
  const streams = new Map();
  const tracker = {
    recordResponse: () => true,
    getBestStream: (tabId) => streams.get(tabId) || null,
    cleanupTab: (tabId) => streams.delete(tabId)
  };
  const prefetcher = createPrefetcher({ tabs, scripting }, tracker);

  const prefetchPromise = prefetcher.prefetchNextEpisodeStream("https://example.com/ep-2", 1000);
  await new Promise((r) => setTimeout(r, 10));

  // Tab was created muted and non-active
  assert.strictEqual(tabs.tabs.size, 1);
  const createdTab = [...tabs.tabs.values()][0];
  assert.strictEqual(createdTab.active, false);
  assert.strictEqual(createdTab.muted, true);

  // Tab completes load -> scripting called with allFrames: true
  tabs.onUpdated.emit(createdTab.id, { status: "complete" });
  assert.strictEqual(scripting.executed.length, 1);
  assert.strictEqual(scripting.executed[0].target.allFrames, true);

  // Stream captured
  streams.set(createdTab.id, { url: "https://cdn.example.com/stream-2.m3u8", referer: "https://example.com/ep-2" });
  prefetcher.onHeadersReceived({ requestId: "123", tabId: createdTab.id, url: "https://cdn.example.com/stream-2.m3u8", statusCode: 200, responseHeaders: [] });

  const result = await prefetchPromise;
  assert.ok(result);
  assert.strictEqual(result.url, "https://cdn.example.com/stream-2.m3u8");

  // Tab was automatically cleaned up
  assert.strictEqual(tabs.tabs.size, 0);
}

async function testTimeoutFallback() {
  const tabs = new MockTabs();
  const scripting = new MockScripting();
  const tracker = {
    recordResponse: () => false,
    getBestStream: () => null,
    cleanupTab: () => {}
  };
  const prefetcher = createPrefetcher({ tabs, scripting }, tracker);

  const result = await prefetcher.prefetchNextEpisodeStream("https://example.com/ep-timeout", 50);
  assert.strictEqual(result, null);
  // Tab closed after timeout
  assert.strictEqual(tabs.tabs.size, 0);
}

async function testEarlyTabRemoval() {
  const tabs = new MockTabs();
  const scripting = new MockScripting();
  const tracker = {
    recordResponse: () => false,
    getBestStream: () => null,
    cleanupTab: () => {}
  };
  const prefetcher = createPrefetcher({ tabs, scripting }, tracker);

  const promise = prefetcher.prefetchNextEpisodeStream("https://example.com/ep-early-close", 500);
  await new Promise((r) => setTimeout(r, 10));

  const tabId = [...tabs.tabs.keys()][0];
  await tabs.remove(tabId);

  const result = await promise;
  assert.strictEqual(result, null);
}

async function testSingleFlightMutex() {
  const tabs = new MockTabs();
  const scripting = new MockScripting();
  const tracker = {
    recordResponse: () => false,
    getBestStream: () => null,
    cleanupTab: () => {}
  };
  const prefetcher = createPrefetcher({ tabs, scripting }, tracker);

  const p1 = prefetcher.prefetchNextEpisodeStream("https://example.com/ep-first", 200);
  const p2 = await prefetcher.prefetchNextEpisodeStream("https://example.com/ep-concurrent", 200);

  // Second concurrent prefetch should immediately return null due to mutex
  assert.strictEqual(p2, null);
  await p1;
}

async function runAll() {
  await testSuccessfulCapture();
  await testTimeoutFallback();
  await testEarlyTabRemoval();
  await testSingleFlightMutex();
  console.log("Pre-fetcher unit tests PASSED.");
}

runAll().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
