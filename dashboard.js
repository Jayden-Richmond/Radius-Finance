// dashboard.js
// Reads assets/dataset.csv, computes weekly spending (sum of purchase_amount) for a given user id
// and computes the average spending per week among users in the same state (location).
// Renders a Chart.js line chart with two lines (user and state average) for the past 6 weeks.

async function fetchText(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error('Failed to fetch ' + path + ' ('+r.status+')');
  return await r.text();
}

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',').map(h=>h.trim());
  const rows = lines.map(l=>{
    // naive split (CSV appears simple in dataset)
    const parts = l.split(',');
    const obj = {};
    for(let i=0;i<header.length;i++) obj[header[i]] = parts[i];
    return obj;
  });
  return {header, rows};
}

function formatMoney(value){
  const n = Number(value);
  if(isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
}

function weekStartISO(dateStr){
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 Sun, 1 Mon
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function lastNWeeks(n){
  // default: end at today
  return lastNWeeksEndingAt(n, new Date().toISOString().slice(0,10));
}

function lastNWeeksEndingAt(n, endIso){
  // endIso: YYYY-MM-DD (inclusive); compute the Monday of that week then back n-1 weeks
  const end = new Date(endIso + 'T00:00:00');
  const day = end.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(end);
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0,0,0,0);
  const labels = [];
  for(let i=n-1;i>=0;i--){
    const d = new Date(monday);
    d.setDate(d.getDate() - i*7);
    labels.push(d.toISOString().slice(0,10));
  }
  return labels;
}

function computeAggregates(rows, userId){
  // user spending per week
  const userMap = new Map();
  // state -> week -> array of user totals (we'll compute averages per user then per week)
  const stateUserWeek = new Map(); // state -> Map(userId -> Map(week->sum))

  for(const r of rows){
    const id = r.id;
    const loc = r.location;
    const date = r.purchase_date;
    const amt = parseFloat(r.purchase_amount);
    if(Number.isNaN(amt)) continue;
    const week = weekStartISO(date);
    // user map
    if(id === userId){
      userMap.set(week, (userMap.get(week) || 0) + amt);
    }
    // state per-user accumulation
    if(!stateUserWeek.has(loc)) stateUserWeek.set(loc, new Map());
    const userMapInState = stateUserWeek.get(loc);
    if(!userMapInState.has(id)) userMapInState.set(id, new Map());
    const weekMap = userMapInState.get(id);
    weekMap.set(week, (weekMap.get(week) || 0) + amt);
  }

  return { userMap, stateUserWeek };
}

function computeStateAverageForWeeks(stateUserWeekMap, state, weeks){
  const res = [];
  const userMap = stateUserWeekMap.get(state) || new Map();
  // for each week, compute average across users (sum each user's total for that week then divide by number of users)
  for(const w of weeks){
    let sum = 0;
    let count = 0;
    for(const [userId, weekMap] of userMap.entries()){
      const v = weekMap.get(w) || 0;
      sum += v;
      count++;
    }
    const avg = count === 0 ? 0 : sum / count;
    res.push(Number(avg.toFixed(2)));
  }
  return res;
}

function mapUserToWeeks(userMap, weeks){
  return weeks.map(w => Number((userMap.get(w) || 0).toFixed(2)));
}

async function drawChartForUser(userId){
  const status = document.getElementById('chart-status');
  const canvas = document.getElementById('dashboardChart');
  if(!canvas){
    console.error('Canvas #dashboardChart not found');
    if(status) status.textContent = 'Chart canvas not found';
    return;
  }
  const ctx = canvas.getContext && canvas.getContext('2d');
  if(!ctx){
    console.error('Unable to get 2d context for canvas');
    if(status) status.textContent = 'Unable to draw chart (no 2D context)';
    return;
  }
  if(typeof Chart === 'undefined'){
    console.error('Chart.js not loaded');
    if(status) status.textContent = 'Chart library not loaded';
    return;
  }
  console.debug('drawChartForUser:', userId);
  try{
  status.textContent = 'Loading data...';
  const text = await fetchText('assets/dataset.csv');
  const {header, rows} = parseCSV(text);
    console.debug('rows parsed:', rows ? rows.length : 0);

  // Extract all unique purchase types
  const purchaseTypes = Array.from(new Set(rows.map(r => r.purchase_type).filter(Boolean)));
  console.debug('purchaseTypes:', purchaseTypes);
  renderPurchaseTypeCheckboxes(purchaseTypes);

    // Use fixed end date: week of 2025-06-30
    const weeks = lastNWeeksEndingAt(6, '2025-06-30');
    const firstRow = rows.find(r => r.id === String(userId));
    const state = firstRow ? firstRow.location : null;
    // Update account balance from CSV for the user (if present).
    // Be robust: CSV may store balances with $ or commas. We'll sanitize; if that fails,
    // fall back to reading the raw CSV line and using the 5th element (index 4).
    try{
      const balanceEl = document.getElementById('balance-amount');
      let balanceValue = NaN;
      if(firstRow && firstRow.balance !== undefined){
        const raw = String(firstRow.balance);
        const cleaned = raw.replace(/[^0-9.-]+/g,'');
        balanceValue = parseFloat(cleaned);
      }
      // fallback: try raw CSV 5th element (index 4)
      if(Number.isNaN(balanceValue)){
        const lines = text.split(/\r?\n/).filter(Boolean);
        // skip header (lines[0]) and search for matching id in column 0
        for(let i=1;i<lines.length;i++){
          const parts = lines[i].split(',');
          if(parts[0] === String(userId)){
            const candidate = parts[4] || '';
            const cleaned2 = String(candidate).replace(/[^0-9.-]+/g,'');
            balanceValue = parseFloat(cleaned2);
            break;
          }
        }
      }
      if(!Number.isNaN(balanceValue)){
        if(balanceEl) balanceEl.textContent = formatMoney(balanceValue);
        try{ localStorage.setItem('balance', String(balanceValue)); }catch(e){}
      }
    }catch(e){/* ignore */}
    if(!state){
      status.textContent = 'User not found in dataset';
      return;
    }

    // Get selected types (allow empty array — we'll show zeros in that case)
    let selectedTypes = getSelectedPurchaseTypes();
    if(!selectedTypes) selectedTypes = [];
    console.debug('selectedTypes:', selectedTypes);

    // Aggregate selected types into summed user and state datasets (one line each)
    const datasets = [];
    // If no types selected, show flat zero-slope lines for both You and state avg
    if(!selectedTypes || selectedTypes.length === 0){
      const zeros = weeks.map(()=>0);
      datasets.push({ label: 'You', data: zeros, borderColor: 'rgba(178,58,53,1)', backgroundColor: 'rgba(178,58,53,0.12)', tension:0.3, fill:true });
  datasets.push({ label: `${state} — state average`, data: zeros, borderColor: 'rgba(80,120,200,1)', backgroundColor: 'rgba(80,120,200,0.12)', tension:0.3, fill:true });
    }else{
      // accumulate per-week sums
      const userMap = new Map();
      const stateUserWeek = new Map(); // state -> Map(userId -> Map(week->sum))
      const typesSet = new Set(selectedTypes);
      for(const r of rows){
        if(!typesSet.has(r.purchase_type)) continue;
        const id = r.id;
        const loc = r.location;
        const date = r.purchase_date;
        const amt = parseFloat(r.purchase_amount);
        if(Number.isNaN(amt)) continue;
        const week = weekStartISO(date);
        if(id === String(userId)){
          userMap.set(week, (userMap.get(week) || 0) + amt);
        }
        if(!stateUserWeek.has(loc)) stateUserWeek.set(loc, new Map());
        const userMapInState = stateUserWeek.get(loc);
        if(!userMapInState.has(id)) userMapInState.set(id, new Map());
        const weekMap = userMapInState.get(id);
        weekMap.set(week, (weekMap.get(week) || 0) + amt);
      }
      const userData = mapUserToWeeks(userMap, weeks);
      const stateAvg = computeStateAverageForWeeks(stateUserWeek, state, weeks);
      datasets.push({ label: 'You', data: userData, borderColor: 'rgba(178,58,53,1)', backgroundColor: 'rgba(178,58,53,0.12)', tension:0.3, fill:true });
  datasets.push({ label: `${state} — state average`, data: stateAvg, borderColor: 'rgba(80,120,200,1)', backgroundColor: 'rgba(80,120,200,0.12)', tension:0.3, fill:true });
    }
    console.debug('datasets count:', datasets.length);
    if(datasets.length === 0){
      console.warn('No datasets generated for selected types');
      status.textContent = 'No data to display for the selected types';
      if(window._dashboardChart) window._dashboardChart.destroy();
      return;
    }
    status.textContent = '';
    if(window._dashboardChart) window._dashboardChart.destroy();
    window._dashboardChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: datasets
      },
      options: { responsive:true, scales: { y: { beginAtZero:true, title: { display:true, text:'Spending (USD)' } }, x: { title: { display:true, text:'Week starting' } } } }
    });

  }catch(err){
    console.error(err);
    status.textContent = 'Failed to load data: ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  // Determine current user id from localStorage (set at login). Fallback to '1' for dev.
  const loggedId = localStorage.getItem('loggedUserId') || '1';
  // Populate welcome message from stored user name
  const welcomeEl = document.getElementById('welcome-msg');
  try{
    const name = localStorage.getItem('loggedUserName') || localStorage.getItem('username') || 'Guest';
    if(welcomeEl) welcomeEl.textContent = 'Welcome, ' + name;
  }catch(e){ /* ignore localStorage failures */ }
  // Wire logout button
  const logoutBtn = document.getElementById('logout-btn');
  if(logoutBtn){
    logoutBtn.addEventListener('click', ()=>{
      // Clear session/local keys used by the app
      try{
        localStorage.removeItem('loggedUserId');
        localStorage.removeItem('loggedUserName');
        localStorage.removeItem('balance');
        // optionally clear persisted dashboard selection
        // localStorage.removeItem('dashboard.selectedPurchaseTypes');
      }catch(e){}
      // Redirect to login page (index.html)
      window.location.href = 'index.html';
    });
  }
  // Immediately draw chart for the logged-in user
  drawChartForUser(loggedId);

  // Listen for purchase type checkbox changes
  document.getElementById('purchase-type-select').addEventListener('change', ()=>{
    drawChartForUser(loggedId);
  });
});

// Render purchase type checkboxes
function renderPurchaseTypeCheckboxes(types){
  const container = document.getElementById('purchase-type-select');
  if(!container) return;
  // Helper: load/save selection to localStorage
  function loadSavedTypes(){
    try{
      const s = localStorage.getItem('dashboard.selectedPurchaseTypes');
      if(!s) return null;
      return JSON.parse(s);
    }catch(e){ return null; }
  }
  function saveSelectedTypes(arr){
    try{ localStorage.setItem('dashboard.selectedPurchaseTypes', JSON.stringify(arr || [])); }catch(e){}
  }

  // NOTE: controls will be created and appended after checkboxes are rendered so
  // they appear below the category options.

  // Only render checkboxes if none exist yet
  if(container.querySelectorAll('input[type=checkbox]').length > 0) return;

  const saved = loadSavedTypes();
  for(const type of types){
    const id = 'ptype-' + type.replace(/\W+/g,'');
    const label = document.createElement('label');
    label.style.marginRight = '10px';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = type;
    // If saved is null => first time -> default to checked; otherwise follow saved state
    cb.checked = saved === null ? true : (Array.isArray(saved) ? saved.indexOf(type) !== -1 : true);
    cb.style.marginRight = '4px';
    cb.id = id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(type));
    container.appendChild(label);
  }

  // After rendering checkboxes, create and append the Select all / Select none controls
  if(!container.querySelector('.ptype-controls')){
    const controls = document.createElement('div');
    controls.className = 'ptype-controls';
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';
    controls.style.margin = '8px 0 0 0';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.textContent = 'Select all';
    selectAllBtn.className = 'btn-select-all';
    selectAllBtn.style.padding = '6px 8px';
    selectAllBtn.style.borderRadius = '6px';
    selectAllBtn.style.border = '1px solid rgba(0,0,0,0.08)';

    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.type = 'button';
    selectNoneBtn.textContent = 'Select none';
    selectNoneBtn.className = 'btn-select-none';
    selectNoneBtn.style.padding = '6px 8px';
    selectNoneBtn.style.borderRadius = '6px';
    selectNoneBtn.style.border = '1px solid rgba(0,0,0,0.08)';

    controls.appendChild(selectAllBtn);
    controls.appendChild(selectNoneBtn);
    container.appendChild(controls);

    selectAllBtn.addEventListener('click', ()=>{
      container.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
      saveSelectedTypes(types.slice());
      container.dispatchEvent(new Event('change'));
    });
    selectNoneBtn.addEventListener('click', ()=>{
      container.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
      saveSelectedTypes([]);
      container.dispatchEvent(new Event('change'));
    });
  }

  // Ensure we save selection on change (only add listener once)
  if(!container.dataset.listenerAdded){
    container.addEventListener('change', ()=>{
      const current = Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
      saveSelectedTypes(current);
    });
    container.dataset.listenerAdded = '1';
  }
}

function getSelectedPurchaseTypes(){
  const container = document.getElementById('purchase-type-select');
  if(!container) return [];
  return Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

