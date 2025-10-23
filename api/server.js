import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { getDomain } from 'tldts';

const app = express();
const PORT = process.env.PORT || 8080;

// Assumptions (override via env on Render)
const ENERGY_KWH_PER_GB = parseFloat(process.env.ENERGY_KWH_PER_GB || '0.81');
const CARBON_G_PER_KWH   = parseFloat(process.env.CARBON_G_PER_KWH   || '475');
const COST_USD_PER_GB    = parseFloat(process.env.COST_USD_PER_GB    || '0.08');

// CORS (allow localhost + your Netlify site)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5500',
  'http://localhost:3000',
  process.env.ALLOW_ORIGIN_1,
  process.env.ALLOW_ORIGIN_2
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, true); // loosened for demo; tighten later if you want
  }
}));
app.use(express.json({ limit: '1mb' }));

// Helper to absolutize URLs
const ABSOLUTE = (base, src) => {
  try { return new URL(src, base).toString(); }
  catch { return null; }
};

// Fetch size via HEAD, fall back to GET
async function headOrGetSize(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!res.ok || !res.headers.get('content-length')) {
      res = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!res.ok) return 0;
      const buf = await res.arrayBuffer();
      return buf.byteLength;
    }
    const len = res.headers.get('content-length');
    return len ? parseInt(len, 10) : 0;
  } catch {
    return 0;
  }
}

function estimateCO2g(bytes) {
  const gb = bytes / (1024 ** 3);
  const kwh = gb * ENERGY_KWH_PER_GB;
  return kwh * CARBON_G_PER_KWH;
}

function estimateCostUSD(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb * COST_USD_PER_GB;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/audit', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Provide a valid http(s) URL' });
    }

    // Fetch page HTML
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return res.status(400).json({ error: 'Failed to fetch URL' });
    const htmlBuf = await response.arrayBuffer();
    const htmlBytes = htmlBuf.byteLength;
    const html = Buffer.from(htmlBuf).toString('utf8');

    // Parse and collect assets
    const $ = cheerio.load(html);
    const base = url;
    const assets = [];

    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = ABSOLUTE(base, href);
      if (abs) assets.push({ type: 'css', url: abs });
    });

    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      const abs = ABSOLUTE(base, src);
      if (abs) assets.push({ type: 'js', url: abs });
    });

    $('img[src]').slice(0, 20).each((_, el) => {
      const src = $(el).attr('src');
      const abs = ABSOLUTE(base, src);
      if (abs) assets.push({ type: 'img', url: abs });
    });

    // De-duplicate URLs
    const seen = new Set();
    const uniqueAssets = assets.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Measure asset sizes (limited concurrency)
    const limit = pLimit(6);
    const assetsWithSize = await Promise.all(uniqueAssets.map(a => limit(async () => {
      const bytes = await headOrGetSize(a.url);
      return { ...a, bytes };
    })));

    // Totals & estimates
    const bytesAssets = assetsWithSize.reduce((sum, a) => sum + (a.bytes || 0), 0);
    const bytesTotal = htmlBytes + bytesAssets;

    const co2_g_per_view = estimateCO2g(bytesTotal);
    const cost_usd_per_view = estimateCostUSD(bytesTotal);

    const co2PerKViews_g = co2_g_per_view * 1000;
    const costPerKViews_usd = cost_usd_per_view * 1000;

    // Suggestions
    const tips = [];
    const largeImgs = assetsWithSize.filter(a => a.type === 'img' && a.bytes > 300*1024);
    if (largeImgs.length) tips.push(`Compress ${largeImgs.length} large images (>300KB).`);
    const bigJS = assetsWithSize.filter(a => a.type === 'js' && a.bytes > 200*1024);
    if (bigJS.length) tips.push(`Reduce or defer ${bigJS.length} large JS files (>200KB).`);
    if (bytesTotal > 2 * 1024*1024) tips.push('Overall page >2MB. Consider lazy-loading and next-gen image formats.');
    const domain = getDomain(new URL(url).hostname || '') || '';
    if (domain) tips.push(`Consider a CDN for ${domain} and enable compression (gzip/brotli).`);

    return res.json({
      ok: true,
      url,
      bytesTotal,
      co2PerKViews_g: Math.round(co2PerKViews_g),
      costPerKViews_usd,
      assets: assetsWithSize,
      tips,
      assumptions: {
        ENERGY_KWH_PER_GB,
        CARBON_G_PER_KWH,
        COST_USD_PER_GB
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
