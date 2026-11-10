const assert = require("assert");
const { parseEpisodes } = require("../extension/episode_detector.js");

function testStandardEpisodeList() {
  const docContext = {
    url: "https://example.com/anime/tsuki-ga-michibiku/episode-1",
    title: "Tsuki ga Michibiku Episode 1 Subtitle Indonesia",
    links: [
      { href: "/anime/tsuki-ga-michibiku/episode-1", text: "Episode 1", className: "active" },
      { href: "/anime/tsuki-ga-michibiku/episode-2", text: "Episode 2", className: "" },
      { href: "/anime/tsuki-ga-michibiku/episode-3", text: "Episode 3", className: "" }
    ],
    options: []
  };

  const result = parseEpisodes(docContext);
  assert.strictEqual(result.totalEpisodes, 3);
  assert.strictEqual(result.currentEpisode, 1);
  assert.ok(result.nextEpisode);
  assert.strictEqual(result.nextEpisode.number, 2);
  assert.strictEqual(result.nextEpisode.url, "https://example.com/anime/tsuki-ga-michibiku/episode-2");
}

function testSelectDropdownAndRelativeUrls() {
  const docContext = {
    url: "https://x6.sokuja.uk/anime/season-2-episode-24/",
    title: "Anime Season 2 Episode 24",
    links: [],
    options: [
      { value: "/anime/season-2-episode-24/", text: "Episode 24", selected: true },
      { value: "/anime/season-2-episode-25/", text: "Episode 25", selected: false }
    ]
  };

  const result = parseEpisodes(docContext);
  assert.strictEqual(result.totalEpisodes, 2);
  assert.strictEqual(result.currentEpisode, 24);
  assert.ok(result.nextEpisode);
  assert.strictEqual(result.nextEpisode.number, 25);
  assert.strictEqual(result.nextEpisode.url, "https://x6.sokuja.uk/anime/season-2-episode-25/");
}

function testFinalEpisode() {
  const docContext = {
    url: "https://example.com/anime/ep-12",
    title: "Anime Ep 12 Finale",
    links: [
      { href: "https://example.com/anime/ep-11", text: "Ep 11", className: "" },
      { href: "https://example.com/anime/ep-12", text: "Ep 12", className: "current" }
    ],
    options: []
  };

  const result = parseEpisodes(docContext);
  assert.strictEqual(result.totalEpisodes, 2);
  assert.strictEqual(result.currentEpisode, 12);
  assert.strictEqual(result.nextEpisode, null);
}

function testSingleVideoOrNoiseIgnored() {
  const docContext = {
    url: "https://example.com/watch?v=123",
    title: "Solo Video Clip",
    links: [
      { href: "https://example.com/other/episode-99", text: "Related Episode 99", className: "" }
    ],
    options: []
  };

  const result = parseEpisodes(docContext);
  // Less than 2 distinct episodes should be ignored to avoid false positives
  assert.strictEqual(result.totalEpisodes, 0);
  assert.strictEqual(result.currentEpisode, null);
  assert.strictEqual(result.nextEpisode, null);
}

function runAll() {
  testStandardEpisodeList();
  testSelectDropdownAndRelativeUrls();
  testFinalEpisode();
  testSingleVideoOrNoiseIgnored();
  console.log("Episode detector unit tests PASSED.");
}

runAll();
