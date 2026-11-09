const assert = require("assert");
const { createStreamTracker } = require("../extension/stream_tracker.js");

const tracker = createStreamTracker();

// 1. Chunks with range headers or chunk extensions are ignored
tracker.trackRequest("req1", 1, "https://cdn.com/seg1.ts", [{ name: "Referer", value: "https://page.com" }]);
assert.strictEqual(tracker.recordResponse("req1", 1, "https://cdn.com/seg1.ts", 200, [{ name: "Content-Type", value: "video/mp2t" }]), false);

tracker.trackRequest("req2", 1, "https://cdn.com/video.mp4", [{ name: "Range", value: "bytes=0-100" }]);
assert.strictEqual(tracker.recordResponse("req2", 1, "https://cdn.com/video.mp4", 206, [{ name: "Content-Type", value: "video/mp4" }]), false);

// 2. Direct MP4 recorded with wire referer
tracker.trackRequest("req3", 1, "https://cdn.com/video.mp4", [{ name: "Referer", value: "https://wire-referer.com" }]);
assert.strictEqual(tracker.recordResponse("req3", 1, "https://cdn.com/video.mp4", 200, [{ name: "Content-Type", value: "video/mp4" }]), true);
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/video.mp4");
assert.strictEqual(tracker.getBestStream(1).referer, "https://wire-referer.com");

// 3. Playlist recorded and strictly prioritized over MP4
tracker.trackRequest("req4", 1, "https://cdn.com/master.m3u8", [{ name: "Referer", value: "https://wire-referer.com" }]);
assert.strictEqual(tracker.recordResponse("req4", 1, "https://cdn.com/master.m3u8", 200, [{ name: "Content-Type", value: "application/vnd.apple.mpegurl" }]), true);
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/master.m3u8");

// 4. Later MP4 chunks NEVER evict discovered playlist
for (let i = 0; i < 10; i++) {
  tracker.trackRequest(`req_mp4_${i}`, 1, `https://cdn.com/segment_${i}.mp4`, []);
  tracker.recordResponse(`req_mp4_${i}`, 1, `https://cdn.com/segment_${i}.mp4`, 200, [{ name: "Content-Type", value: "video/mp4" }]);
}
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/master.m3u8");

// 5. Unmatched response does not crash or adopt wrong referer
assert.strictEqual(tracker.recordResponse("unknown_req", 1, "https://cdn.com/other.mp4", 200, [{ name: "Content-Type", value: "video/mp4" }]), true);
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/master.m3u8"); // Playlist still retained

// 6. Tab cleanup removes all tab entries and requests
tracker.cleanupTab(1);
assert.strictEqual(tracker.getBestStream(1), null);

console.log("Stream tracker unit tests PASSED.");
