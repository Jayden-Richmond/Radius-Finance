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

      // Only accept the hardcoded demo credentials for now
      if(account.value === 'demo' && password.value === 'demo' && accountId.value === '0000'){
        // mark demo session
        localStorage.setItem('currentUser', 'demo');
        // ensure a default balance exists for the demo
        if(localStorage.getItem('balance') === null){
          localStorage.setItem('balance', '0.00');
        }
        // navigate to dashboard
        window.location.href = 'dashboard.html';
        return;
      }

      // otherwise show an error
      alert('Invalid credentials. For this demo, use: account: demo, password: demo, id: 0000');
      return;
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