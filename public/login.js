const form=document.querySelector('#loginForm');
const errorBox=document.querySelector('#loginError');

async function json(url,opts={}){
  const r=await fetch(url,opts);let body={};try{body=await r.json()}catch{}
  return {r,body};
}

async function boot(){
  try{
    const {body}=await json('/api/auth/status');
    if(body.authenticated){location.replace('/');return}
  }catch{}
  document.querySelector('#username')?.focus();
}

form?.addEventListener('submit',async e=>{
  e.preventDefault();errorBox.hidden=true;
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
    const username=document.querySelector('#username').value.trim();
    const password=document.querySelector('#password').value;
    const {r,body}=await json('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
    if(!r.ok)throw new Error(body.error||'Login non riuscito');
    location.replace('/');
  }catch(error){errorBox.textContent=error.message;errorBox.hidden=false}
  finally{button.disabled=false}
});

boot();
