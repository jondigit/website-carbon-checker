// In dev (localhost) call the API directly; in production use Netlify proxy (/api/*)
const API_BASE = (window.location.hostname === 'localhost')
  ? 'http://localhost:8080'
  : ''; // use relative /api in production via netlify.toml proxy

const form = document.getElementById('audit-form');
const results = document.getElementById('results');
const bytesTotalEl = document.getElementById('bytesTotal');
const co2El = document.getElementById('co2');
const costEl = document.getElementById('cost');
const assetsTable = document.querySelector('#assetsTable tbody');
const tipsDiv = document.getElementById('tips');

function fmtBytes(num) {
  if (num < 1024) return `${num} B`;
  if (num < 1024*1024) return `${(num/1024).toFixed(1)} KB`;
  if (num < 1024*1024*1024) return `${(num/1024/1024).toFixed(2)} MB`;
  return `${(num/1024/1024/1024).toFixed(2)} GB`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = new FormData(form).get('url');
  results.classList.remove('hidden');
  bytesTotalEl.textContent = 'Running…';
  co2El.textContent = 'Running…';
  costEl.textContent = 'Running…';
  assetsTable.innerHTML = '';
  tipsDiv.innerHTML = '';

  try {
    const r = await fetch(`${API_BASE}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ url })
    });
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const data = await r.json();

    bytesTotalEl.textContent = fmtBytes(data.bytesTotal || 0);
    co2El.textContent = `${(data.co2PerKViews_g || 0).toLocaleString()} g / 1k views`;
    costEl.textContent = `$${(data.costPerKViews_usd || 0).toFixed(2)} / 1k views`;

    for (const a of data.assets || []) {
      const tr = document.createElement('tr');
      const type = document.createElement('td');
      type.textContent = a.type;
      const link = document.createElement('td');
      const aTag = document.createElement('a');
      aTag.href = a.url;
      aTag.target = '_blank';
      aTag.rel = 'noopener';
      aTag.textContent = a.url;
      link.appendChild(aTag);
      const size = document.createElement('td');
      size.textContent = fmtBytes(a.bytes);
      tr.append(type, link, size);
      assetsTable.appendChild(tr);
    }

    if (data.tips && data.tips.length) {
      const ul = document.createElement('ul');
      for (const t of data.tips) {
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
      }
      tipsDiv.innerHTML = `<h3>Suggested fixes</h3>`;
      tipsDiv.appendChild(ul);
    }
  } catch (err) {
    bytesTotalEl.textContent = 'Error';
    co2El.textContent = 'Error';
    costEl.textContent = 'Error';
    tipsDiv.innerHTML = `<p style="color:#fca5a5">Failed to audit. Check the URL or try another page.</p>`;
    console.error(err);
  }
});
