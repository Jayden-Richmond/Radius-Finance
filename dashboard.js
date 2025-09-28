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
  const ctx = document.getElementById('dashboardChart').getContext('2d');
  try{
    status.textContent = 'Loading data...';
    const text = await fetchText('assets/dataset.csv');
    const {rows} = parseCSV(text);

  // Use fixed end date: week of 2025-06-30
  const weeks = lastNWeeksEndingAt(6, '2025-06-30');
    const {userMap, stateUserWeek} = computeAggregates(rows, String(userId));

    // determine user's state (first matching row for user)
    const firstRow = rows.find(r => r.id === String(userId));
    const state = firstRow ? firstRow.location : null;
    if(!state){
      status.textContent = 'User not found in dataset';
      return;
    }

    const userData = mapUserToWeeks(userMap, weeks);
    const stateAvg = computeStateAverageForWeeks(stateUserWeek, state, weeks);

    status.textContent = '';

    // Create Chart
    if(window._dashboardChart) window._dashboardChart.destroy();
    window._dashboardChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          { label: 'You', data: userData, borderColor: 'rgba(178,58,53,1)', backgroundColor: 'rgba(178,58,53,0.12)', tension:0.3, fill:true },
          { label: state + ' avg', data: stateAvg, borderColor: 'rgba(80,120,200,1)', backgroundColor: 'rgba(80,120,200,0.12)', tension:0.3, fill:true }
        ]
      },
      options: { responsive:true, scales: { y: { beginAtZero:true, title: { display:true, text:'Spending (USD)' } }, x: { title: { display:true, text:'Week starting' } } } }
    });

  }catch(err){
    console.error(err);
    status.textContent = 'Failed to load data: ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const loadBtn = document.getElementById('load-chart');
  const userInput = document.getElementById('user-id');
  loadBtn.addEventListener('click', ()=>{
    const id = userInput.value.trim();
    if(!id){ document.getElementById('chart-status').textContent = 'Enter a user id'; return; }
    drawChartForUser(id);
  });
  // prefill with 1 and load
  userInput.value = '1';
  drawChartForUser('1');
});
