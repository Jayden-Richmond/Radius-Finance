document.addEventListener('DOMContentLoaded', ()=>{
  const getStarted = document.getElementById('get-started');
  const loginSection = document.getElementById('login');
  const loginBtn = document.getElementById('login-btn');
  const back = document.getElementById('back-btn');

  if(getStarted){
    getStarted.addEventListener('click', ()=>{
      if(loginSection){
        loginSection.classList.remove('hidden');
        loginSection.setAttribute('aria-hidden','false');
        // lock background scroll while modal is open
        document.body.classList.add('modal-open');
        setTimeout(()=>{ const el = document.getElementById('account'); if(el) el.focus(); },150);
      }
    });
  }

  if(loginBtn){
    loginBtn.addEventListener('click', ()=>{
      const account = document.getElementById('account');
      const password = document.getElementById('password');
      const accountId = document.getElementById('account-id');
      if(!account.value || !password.value || !accountId.value){
        alert('Please fill all fields before continuing.');
        return;
      }

      const acctName = account.value.trim();
      const acctPass = password.value;
      const acctId = accountId.value.trim();

      // Fetch CSV and validate credentials
      fetch('assets/dataset.csv')
        .then(r => { if(!r.ok) throw new Error('Network response was not ok'); return r.text(); })
        .then(text => {
          const lines = text.split(/\r?\n/).filter(Boolean);
          if(lines.length === 0) throw new Error('Empty CSV');
          const headers = lines.shift().split(',').map(h=>h.trim());
          const rows = lines.map(line => {
            const parts = line.split(',');
            const obj = {};
            for(let i=0;i<headers.length;i++) obj[headers[i]] = (parts[i]||'').trim();
            return obj;
          });

          // Check if any user exists with provided id or name
          const anyMatch = rows.find(r => r.id === acctId || (r.name && r.name === acctName));
          if(!anyMatch){
            alert('User name or user id does not exist.');
            return;
          }

          // Find exact user record (id + name)
          const userRow = rows.find(r => r.id === acctId && r.name === acctName);
          if(!userRow){
            alert('User name or user id does not exist.');
            return;
          }

          // Validate password
          if(userRow.password !== acctPass){
            alert('Password incorrect.');
            return;
          }

          // Success: save user session and redirect
          localStorage.setItem('loggedUserId', userRow.id);
          localStorage.setItem('loggedUserName', userRow.name);
          // ensure a default balance exists
          if(localStorage.getItem('balance') === null){
            localStorage.setItem('balance', '0.00');
          }
          window.location.href = 'dashboard.html';
        })
        .catch(err => {
          console.error('Login error', err);
          alert('Failed to verify credentials: ' + err.message + '\nMake sure you are running the site over HTTP (localhost) so the CSV can be fetched.');
        });
    });
  }

  if(back){
    back.addEventListener('click', ()=>{ closeModal(); });
  }

  // Close modal helper
  function closeModal(){
    if(!loginSection) return;
    loginSection.classList.add('hidden');
    loginSection.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
  }

  // click outside the card to close
  if(loginSection){
    loginSection.addEventListener('click', (e)=>{ if(e.target === loginSection) closeModal(); });
  }

  // ESC to close
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModal(); });
});