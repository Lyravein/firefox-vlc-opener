function parseEpisodes(documentContext) {
  const baseUrl = documentContext?.url || "";
  const resolveUrl = (raw) => {
    if (!raw || /^javascript:/i.test(raw) || raw.startsWith("#")) return null;
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return null;
    }
  };

  const candidates = [];
  const sources = [];
  for (const item of documentContext?.links || []) {
    sources.push({ href: item.href, value: null, text: item.text, className: item.className, selected: false });
  }
  for (const item of documentContext?.options || []) {
    sources.push({ href: null, value: item.value, text: item.text, className: "", selected: item.selected === true });
  }

  for (const item of sources) {
    const textMatch = (item.text || "").match(/(?:episode|eps|ep)[.\s-]*(\d+)/i);
    const match = textMatch || (item.href || item.value || "").match(/(?:^|[/-])ep(?:isode)?[.-]?(\d+)(?:[/-]|\.html|$)/i);
    if (!match) continue;
    const number = parseInt(match[1], 10);
    const url = resolveUrl(item.href || item.value);
    if (number > 0 && url) candidates.push({ number, url, active: /active|current/i.test(item.className || "") || item.selected });
  }

  const byNumber = new Map();
  for (const candidate of candidates) {
    if (!byNumber.has(candidate.number)) byNumber.set(candidate.number, candidate);
  }
  const sorted = [...byNumber.values()].sort((a, b) => a.number - b.number);
  if (sorted.length < 2) return { episodes: [], currentEpisode: null, totalEpisodes: 0, nextEpisode: null };

  let currentEpisode = candidates.find((candidate) => candidate.active)?.number ?? null;
  const findNumber = (value) => {
    const textMatch = (value || "").match(/(?:episode|eps|ep)[.\s-]*(\d+)/i);
    const match = textMatch || (value || "").match(/(?:^|[/-])ep(?:isode)?[.-]?(\d+)(?:[/-]|\.html|$)/i);
    if (!match) return null;
    const number = parseInt(match[1], 10);
    return number > 0 ? number : null;
  };
  if (currentEpisode === null) currentEpisode = findNumber(baseUrl) ?? findNumber(documentContext?.title);
  if (currentEpisode === null) {
    const resolvedBase = resolveUrl(baseUrl);
    currentEpisode = sorted.find((episode) => episode.url === resolvedBase)?.number ?? null;
  }

  let nextEpisode = null;
  if (currentEpisode !== null) {
    const next = sorted.find((episode) => episode.number === currentEpisode + 1) || sorted.find((episode) => episode.number > currentEpisode);
    if (next) nextEpisode = { number: next.number, url: next.url };
  }
  return {
    episodes: sorted.map(({ number, url }) => ({ number, url })),
    currentEpisode,
    totalEpisodes: sorted.length,
    nextEpisode,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseEpisodes };
}
