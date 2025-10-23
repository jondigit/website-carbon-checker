// Use Netlify proxy in production; direct port in dev
const API_BASE = (window.location.hostname === 'localhost')
  ? 'http://localhost:8080'
  : ''; // production uses /api/* via netlify.toml

const $ = (sel) => document.querySelector(sel);
const form = $('#audit-form');
const runBtn = $('#runBtn');
const results = $('#results');
const bytesTotalEl = $('#bytesTotal');
const co2El = $('#co2');
const costEl = $('#cost');
const assetsTable = $('#assetsTable tbody');
const tipsDiv = $('#tips');
const loading = $('#loading');
const toast = $('#toast');

const kpiCo2 = $('#kpiCo2');
const kpiCost = $('#kpiCost');
const kpiBytes = $('#kpiBytes');
const kpiAudits = $('#kpiAudits');
const historyTable = $('#historyTable tbody');
const clearBtn = $('#clearHistory');
const exportBtn = $('#exportHistory');

const chartEls = {
  assetMix: $('#chartAssetMix'),
  latestBars: $('#chartLatestBars'),
  co2Trend: $('#chartCo2Trend')
};
let charts = { assetMix:null, latestBars:null, co2Trend:null };

document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- Utilities ---------- */
function showToast(msg, ok=false){
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.toggle('ok', !!ok);
  setTimeout(() => toast.classList.add('hidden'), 4000);
}
function fmtBytes(num){
  if (!Number.isFinite(num)) return '—';
  if (num < 1024) return `${num} B`;
  if (num < 1024*1024) return `${(num/1024).toFixed(1)} KB`;
  if (num < 1024*1024*1024) return `${(num/1024/1024).toFixed(2)} MB`;
  return `${(num/1024/1024/1024).toFixed(2)} GB`;
}
function isLikelyURL(v){
  try { const u = new URL(v); return /^https?:$/.test(u.protocol); } catch { return false; }
}
function postAudit(url){
  return fetch(`${API_BASE}/api/audit`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ url })
  }).then(r => {
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  });
}

/* ---------- Local storage history ---------- */
const KEY = 'ecometrics_history_v1';
function loadHistory(){
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}
function saveHistory(arr){
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-50))); // keep last 50
}
function addHistory(entry){
  const h = loadHistory();
  h.push(entry);
  saveHistory(h);
  return h;
}

/* ---------- Dashboard rendering ---------- */
function renderKPIs(history){
  if (!history.length){
    kpiCo2.textContent = '—';
    kpiCost.textContent = '—';
    kpiBytes.textContent = '—';
    kpiAudits.textContent = '0';
    return;
  }
  const avg = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length;
  kpiCo2.textContent = `${Math.round(avg(history, 'co2PerKViews_g')).toLocaleString()} g`;
  kpiCost.textContent = `$${avg(history, 'costPerKViews_usd').toFixed(2)}`;
  kpiBytes.textContent = fmtBytes(avg(history, 'bytesTotal'));
  kpiAudits.textContent = String(history.length);
}

function renderHistoryTable(history){
  historyTable.innerHTML = '';
  [...history].slice(-10).reverse().forEach(h => {
    const tr = document.createElement('tr');
    const date = new Date(h.ts).toLocaleString();
    tr.innerHTML = `
      <td>${date}</td>
      <td><a href="${h.url}" target="_blank" rel="noopener">${h.url}</a></td>
      <td>${fmtBytes(h.bytesTotal)}</td>
      <td>${(h.co2PerKViews_g).toLocaleString()} g</td>
      <td>$${(h.costPerKViews_usd).toFixed(2)}</td>
    `;
    historyTable.appendChild(tr);
  });
}

function destroyChart(k){ if (charts[k]) { charts[k].destroy(); charts[k] = null; } }

function renderAssetMix(latest){
  destroyChart('assetMix');
  if (!latest || !latest.assets) return;
  const byType = latest.assets.reduce((m, a) => (m[a.type]=(m[a.type]||0)+(a.bytes||0), m), {});
  const labels = Object.keys(byType);
  const data = labels.map(l => byType[l]);
  charts.assetMix = new Chart(chartEls.assetMix, {
    type: 'doughnut',
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: { legend: { position: 'bottom', labels: { color:'#cbd5e1' } } }
    }
  });
}

function renderLatestBars(latest){
  destroyChart('latestBars');
  if (!latest) return;
  charts.latestBars = new Chart(chartEls.latestBars, {
    type: 'bar',
    data: {
      labels: ['Page weight (MB)', 'CO₂ / 1k (g)', 'Cost / 1k ($)'],
      datasets: [{
        data: [
          (latest.bytesTotal || 0) / (1024*1024),
          latest.co2PerKViews_g || 0,
          latest.costPerKViews_usd || 0
        ]
      }]
    },
    options: {
      scales: {
        x: { ticks: { color:'#cbd5e1' }, grid: { color:'#1f2a33' } },
        y: { ticks: { color:'#cbd5e1' }, grid: { color:'#1f2a33' } }
      },
      plugins: { legend: { display:false } }
    }
  });
}

function renderCo2Trend(history){
  destroyChart('co2Trend');
  if (!history.length) return;
  const last = history.slice(-10);
  charts.co2Trend = new Chart(chartEls.co2Trend, {
    type: 'line',
    data: {
      labels: last.map(x => new Date(x.ts).toLocaleTimeString()),
      datasets: [{ label: 'CO₂ / 1k (g)', data: last.map(x => x.co2PerKViews_g) }]
    },
    options: {
      plugins: { legend: { labels: { color:'#cbd5e1' } } },
      scales: {
        x: { ticks: { color:'#cbd5e1' }, grid: { color:'#1f2a33' } },
        y: { ticks: { color:'#cbd5e1' }, grid: { color:'#1f2a33' } }
      }
    }
  });
}

function refreshDashboard(){
  const history = loadHistory();
  renderKPIs(history);
  renderHistoryTable(history);
  const latest = history[history.length - 1];
  renderAssetMix(latest);
  renderLatestBars(latest);
  renderCo2Trend(history);
}

/* ---------- Audit flow ---------- */
function resetResults(){
  results.classList.remove('hidden');
  loading.classList.remove('hidden');
  assetsTable.innerHTML = '';
  tipsDiv.innerHTML = '';
  bytesTotalEl.textContent = '—';
  co2El.textContent = '—';
  costEl.textContent = '—';
}

function fillResults(data){
  bytesTotalEl.textContent = fmtBytes(data.bytesTotal || 0);
  co2El.textContent = `${(data.co2PerKViews_g || 0).toLocaleString()} g / 1k views`;
  costEl.textContent = `$${(data.costPerKViews_usd || 0).toFixed(2)} / 1k views`;

  for (const a of (data.assets || [])){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${a.type}</td>
      <td><a href="${a.url}" target="_blank" rel="noopener">${a.url}</a></td>
      <td>${fmtBytes(a.bytes)}</td>`;
    assetsTable.appendChild(tr);
  }

  if (data.tips && data.tips.length){
    const ul = document.createElement('ul');
    data.tips.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    tipsDiv.innerHTML = `<h3>Suggested fixes</h3>`;
    tipsDiv.appendChild(ul);
  } else {
    tipsDiv.innerHTML = `<div class="toast ok">No major issues detected.</div>`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = new FormData(form).get('url').trim();

  if (!isLikelyURL(url)){
    showToast('Please enter a valid URL starting with http:// or https://');
    return;
  }

  resetResults();
  runBtn.disabled = true;

  try {
    const data = await postAudit(url);
    fillResults(data);

    // Save to history
    const entry = {
      ts: Date.now(),
      url: data.url || url,
      bytesTotal: data.bytesTotal || 0,
      co2PerKViews_g: data.co2PerKViews_g || 0,
      costPerKViews_usd: data.costPerKViews_usd || 0,
      assets: data.assets || []
    };
    addHistory(entry);
    refreshDashboard();

    showToast('Audit complete', true);
    results.scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (err) {
    console.error(err);
    tipsDiv.innerHTML = `<div class="toast">Failed to audit. The site may block automated requests or the URL is not public.</div>`;
    bytesTotalEl.textContent = 'Error';
    co2El.textContent = 'Error';
    costEl.textContent = 'Error';
    showToast('Audit failed. Try another page or contact us.', false);
  } finally {
    loading.classList.add('hidden');
    runBtn.disabled = false;
  }
});

/* ---------- History actions ---------- */
clearBtn?.addEventListener('click', () => {
  localStorage.removeItem(KEY);
  refreshDashboard();
  showToast('Local history cleared', true);
});

exportBtn?.addEventListener('click', () => {
  const h = loadHistory();
  if (!h.length){ showToast('No data to export'); return; }
  const rows = [['timestamp','url','bytesTotal','co2PerKViews_g','costPerKViews_usd']];
  h.forEach(x => rows.push([x.ts, x.url, x.bytesTotal, x.co2PerKViews_g, x.costPerKViews_usd]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ecometrics_audits.csv';
  a.click();
});

/* ---------- Init ---------- */
refreshDashboard();
