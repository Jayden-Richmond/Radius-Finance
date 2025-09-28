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
      // Check demo credentials and reveal dashboard
      if(account.value === 'demo' && password.value === 'demo' && accountId.value === '0000'){
        // Close login modal
        closeModal();
        // Hide the hero/start screen
        const hero = document.querySelector('.hero'); if(hero) hero.classList.add('hidden');
        // Reveal dashboard
        const dashboard = document.getElementById('dashboard');
        if(dashboard){ dashboard.classList.remove('hidden'); dashboard.setAttribute('aria-hidden','false'); }
        // focus on dashboard for screen readers
        setTimeout(()=>{ const bd = document.getElementById('dashboard'); if(bd) bd.focus(); }, 80);
      } else {
        alert('Invalid demo credentials. Use account: demo, password: demo, id: 0000');
      }
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