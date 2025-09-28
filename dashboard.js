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

function getRowsDateRange(rows){
  let min = null, max = null;
  for(const r of rows){
    const ds = r.purchase_date;
    if(!ds) continue;
    const t = Date.parse(ds);
    if(Number.isNaN(t)) continue;
    const iso = new Date(t).toISOString().slice(0,10);
    if(min === null || iso < min) min = iso;
    if(max === null || iso > max) max = iso;
  }
  return { min, max };
}

function weeksFromRange(startIso, endIso){
  // Return array of ISO dates (YYYY-MM-DD) for each Monday between start and end inclusive
  const start = new Date(startIso + 'T00:00:00');
  const dayS = start.getDay();
  const diffS = (dayS === 0 ? -6 : 1 - dayS);
  const mondayStart = new Date(start);
  mondayStart.setDate(mondayStart.getDate() + diffS);
  mondayStart.setHours(0,0,0,0);

  const end = new Date(endIso + 'T00:00:00');
  const dayE = end.getDay();
  const diffE = (dayE === 0 ? -6 : 1 - dayE);
  const mondayEnd = new Date(end);
  mondayEnd.setDate(mondayEnd.getDate() + diffE);
  mondayEnd.setHours(0,0,0,0);

  const labels = [];
  for(let d = new Date(mondayStart); d <= mondayEnd; d.setDate(d.getDate() + 7)){
    labels.push(d.toISOString().slice(0,10));
    if(labels.length > 520) break; // safety cap to avoid runaway array
  }
  return labels;
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

    // Determine date range from dataset and from user-selected controls.
    const { min: datasetMin, max: datasetMax } = getRowsDateRange(rows);

    // Wire up date inputs (they exist in dashboard.html). We'll set min/max and default values
    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    const resetBtn = document.getElementById('reset-range-btn');
    if(startInput && endInput && datasetMin && datasetMax){
      startInput.min = datasetMin;
      startInput.max = datasetMax;
      endInput.min = datasetMin;
      endInput.max = datasetMax;
      // restore saved range if available, otherwise default to full dataset range
      const savedStart = localStorage.getItem('dashboard.rangeStart');
      const savedEnd = localStorage.getItem('dashboard.rangeEnd');
      startInput.value = savedStart || datasetMin;
      endInput.value = savedEnd || datasetMax;

      // Ensure listeners are added only once: store a flag on the element
      if(!startInput.dataset.listenerAdded){
        startInput.addEventListener('change', ()=>{
          // persist and redraw
          localStorage.setItem('dashboard.rangeStart', startInput.value);
          drawChartForUser(userId);
        });
        startInput.dataset.listenerAdded = '1';
      }
      if(!endInput.dataset.listenerAdded){
        endInput.addEventListener('change', ()=>{
          localStorage.setItem('dashboard.rangeEnd', endInput.value);
          drawChartForUser(userId);
        });
        endInput.dataset.listenerAdded = '1';
      }
      if(resetBtn && !resetBtn.dataset.listenerAdded){
        resetBtn.addEventListener('click', ()=>{
          startInput.value = datasetMin;
          endInput.value = datasetMax;
          localStorage.setItem('dashboard.rangeStart', datasetMin);
          localStorage.setItem('dashboard.rangeEnd', datasetMax);
          drawChartForUser(userId);
        });
        resetBtn.dataset.listenerAdded = '1';
      }
    }

    // Decide which weeks to show. Prefer explicit start/end from inputs when available.
    let weeks = null;
    if(startInput && endInput && startInput.value && endInput.value){
      let s = startInput.value;
      let e = endInput.value;
      if(s > e){ // swap to make a valid range
        const tmp = s; s = e; e = tmp;
      }
      weeks = weeksFromRange(s, e);
    }
    // Fallback: if no valid range, show last 6 weeks ending at dataset max (or today)
    if(!weeks || weeks.length === 0){
      if(datasetMax) weeks = lastNWeeksEndingAt(6, datasetMax);
      else weeks = lastNWeeks(6);
    }
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

      // Add faint horizontal region-average lines per selected purchase type using filtered_expenditures.csv
      try{
        const feText = await fetchText('filtered_expenditures.csv');
        const feMap = parseFilteredExpenditures(feText);
        const region = stateToRegion(state);
        const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
        // aggregate matched weekly means across selected types into a single horizontal line
        let totalWeekly = 0;
        let matchedCount = 0;
        const matchedKeys = [];
        for(const t of selectedTypes){
          // find best match in filtered_expenditures
          const target = norm(t);
          let matchedKey = null;
          for(const key of feMap.keys()){
            const k = norm(key);
            if(k === target || k.includes(target) || target.includes(k)){
              matchedKey = key; break;
            }
          }
          if(!matchedKey) continue;
          const entry = feMap.get(matchedKey);
          if(!entry) continue;
          const weeklyVal = Number(entry[region] || entry['United States'] || 0);
          if(Number.isNaN(weeklyVal)) continue;
          totalWeekly += weeklyVal;
          matchedKeys.push(matchedKey);
          matchedCount++;
        }
        if(matchedCount > 0){
          const roundedTotal = Number(totalWeekly.toFixed(2));
          // Scale the aggregated regional weekly mean by user's weekly income relative to the region's average weekly income
          let adjustedTotal = roundedTotal;
          try{
            const regionAvgInc = computeRegionAverageWeeklyIncome(rows, region);
            // Determine user weekly income from dataset (prefer explicit weekly column)
            const userIncRaw = (firstRow && (firstRow.income_weekly || firstRow.income_yearly)) ? (Number(firstRow.income_weekly) || (Number(firstRow.income_yearly) / 52)) : NaN;
            const userWeeklyInc = Number(userIncRaw);
            if(regionAvgInc && Number.isFinite(userWeeklyInc) && userWeeklyInc > 0 && regionAvgInc > 0){
              const factor = userWeeklyInc / regionAvgInc;
              adjustedTotal = Number((roundedTotal * factor).toFixed(2));
            }
          }catch(e){ /* if anything fails, fall back to unadjusted value */ }
           const horiz = weeks.map(()=>roundedTotal);
           const labelBase = matchedCount === 1 ? `${region} avg — ${matchedKeys[0]} (weekly)` : `${region} avg — selected types (weekly)`;
           const label = adjustedTotal !== roundedTotal ? `${labelBase} — adjusted to your income` : labelBase;
           const horizData = weeks.map(()=>adjustedTotal);
           datasets.push({ label: label, data: horizData, borderColor: 'rgba(120,120,120,0.28)', borderDash:[6,6], pointRadius:0, fill:false });
        }
      }catch(e){
        console.warn('filtered_expenditures.csv not available or failed to parse', e);
      }
 
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

function parseFilteredExpenditures(text){
  // Expect CSV with header: Item,United States Mean (Weekly $),Northeast Mean (Weekly $),Midwest Mean (Weekly $),South Mean (Weekly $),West Mean (Weekly $)
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(lines.length === 0) return new Map();
  const header = lines.shift().split(',').map(h => h.trim());
  // find indices
  const idx = {};
  header.forEach((h,i) => { idx[h] = i; });
  const m = new Map();
  for(const l of lines){
    const parts = l.split(',');
    const item = parts[0];
    if(!item) continue;
    const entry = {
      'United States': parseFloat(parts[idx['United States Mean (Weekly $)']] || '0') || 0,
      'Northeast': parseFloat(parts[idx['Northeast Mean (Weekly $)']] || '0') || 0,
      'Midwest': parseFloat(parts[idx['Midwest Mean (Weekly $)']] || '0') || 0,
      'South': parseFloat(parts[idx['South Mean (Weekly $)']] || '0') || 0,
      'West': parseFloat(parts[idx['West Mean (Weekly $)']] || '0') || 0
    };
    m.set(String(item).trim(), entry);
  }
  return m;
}

function stateToRegion(state){
  if(!state) return 'United States';
  const s = String(state).trim();
  const mapping = {
    'Connecticut':'Northeast','Maine':'Northeast','Massachusetts':'Northeast','New Hampshire':'Northeast','Rhode Island':'Northeast','Vermont':'Northeast','New Jersey':'Northeast','New York':'Northeast','Pennsylvania':'Northeast',
    'Illinois':'Midwest','Indiana':'Midwest','Michigan':'Midwest','Ohio':'Midwest','Wisconsin':'Midwest','Iowa':'Midwest','Kansas':'Midwest','Minnesota':'Midwest','Missouri':'Midwest','Nebraska':'Midwest','North Dakota':'Midwest','South Dakota':'Midwest',
    'Delaware':'South','Florida':'South','Georgia':'South','Maryland':'South','North Carolina':'South','South Carolina':'South','Virginia':'South','West Virginia':'South','Alabama':'South','Kentucky':'South','Mississippi':'South','Tennessee':'South','Arkansas':'South','Louisiana':'South','Oklahoma':'South','Texas':'South','District of Columbia':'South',
    'Arizona':'West','Colorado':'West','Idaho':'West','Montana':'West','Nevada':'West','New Mexico':'West','Utah':'West','Wyoming':'West','Alaska':'West','California':'West','Hawaii':'West','Oregon':'West','Washington':'West'
  };
  return mapping[s] || 'United States';
}

function computeRegionAverageWeeklyIncome(rows, region){
  const seen = new Set();
  let sum = 0;
  let count = 0;
  for(const r of rows){
    const id = String(r.id);
    if(seen.has(id)) continue;
    seen.add(id);
    const reg = stateToRegion(r.location);
    if(reg !== region) continue;
    let inc = Number(r.income_weekly);
    if(Number.isNaN(inc) || inc === 0){
      const y = Number(r.income_yearly);
      if(!Number.isNaN(y) && y !== 0) inc = y / 52;
    }
    if(Number.isNaN(inc) || inc === 0) continue;
    sum += inc;
    count++;
  }
  return count === 0 ? null : (sum / count);
}

