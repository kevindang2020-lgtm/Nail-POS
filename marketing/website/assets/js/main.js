// header scroll state
const header=document.querySelector('.site-header');
const onScroll=()=>{header.classList.toggle('scrolled',window.scrollY>12);};
window.addEventListener('scroll',onScroll,{passive:true});onScroll();

// mobile menu
const mm=document.getElementById('mobileMenu'),burger=document.getElementById('hamburger');
const openMM=()=>{mm.classList.add('open');burger.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';};
const closeMM=()=>{mm.classList.remove('open');burger.setAttribute('aria-expanded','false');document.body.style.overflow='';};
burger.addEventListener('click',openMM);
document.getElementById('mmClose').addEventListener('click',closeMM);
mm.addEventListener('click',e=>{if(e.target===mm)closeMM();});
mm.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMM));

// Home / logo -> always return to the very first pixel of the page
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelectorAll('a[href="#top"]').forEach(a=>{
  a.addEventListener('click',(e)=>{
    e.preventDefault();
    window.scrollTo({top:0,behavior:reduceMotion?'auto':'smooth'});
    history.replaceState(null,'',location.pathname+location.search);
  });
});

// faq accordion
document.querySelectorAll('.faq-item').forEach(item=>{
  const q=item.querySelector('.faq-q'),a=item.querySelector('.faq-a');
  q.addEventListener('click',()=>{
    const open=item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(o=>{o.classList.remove('open');o.querySelector('.faq-a').style.maxHeight=null;});
    if(!open){item.classList.add('open');a.style.maxHeight=a.scrollHeight+'px';}
  });
});

// scroll reveal
const io=new IntersectionObserver((entries)=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

// form handling
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : '';
const FORM_VERSION="2026-07-25";
const CONSENT_TEXT="I agree to be contacted by AIPowerSalon by SMS, phone, or email about my application.";
const form=document.getElementById('applyForm');
const success=document.getElementById('formSuccess');
// One idempotency key per submission attempt-set: a double-tap or refresh-and-resubmit re-sends the SAME key,
// so the backend returns the same reference instead of creating a duplicate record.
let idemKey=null;
const utmData=(()=>{const o={};try{const q=new URLSearchParams(location.search);for(const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']){const v=q.get(k);if(v)o[k]=v;}if(document.referrer)o.referrer=document.referrer.slice(0,200);}catch(_e){}return o;})();
let submitting=false;
form.addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(submitting)return; // double-submit guard (belt; idempotency key is the suspenders)
  // honeypot
  if(form.company_website.value){return;}
  let valid=true;
  form.querySelectorAll('[required]').forEach(f=>{
    const field=f.closest('.field');
    const ok=f.type==='checkbox'?f.checked:f.value.trim()!=='';
    if(field){field.classList.toggle('invalid',!ok);}
    if(!ok)valid=false;
  });
  if(!valid){form.querySelector('.invalid input,.invalid select')?.focus();return;}

  // build payload mapped to POST /public/website/applications
  const fd=new FormData(form);
  const payload=Object.fromEntries(fd.entries());
  payload.interested_hardware=fd.getAll('interested_hardware');
  payload.sms_email_consent=form.sms_email_consent.checked;
  payload.consent_text=CONSENT_TEXT;
  payload.source='website';
  payload.form_version=FORM_VERSION;
  if(Object.keys(utmData).length)payload.utm=utmData;
  if(!idemKey){idemKey=(crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);}
  payload.idempotency_key=idemKey;
  delete payload.company_website;

  const btn=form.querySelector('button[type="submit"]');
  const err=document.getElementById('formError');
  if(err)err.style.display='none';
  try{
    if(API_BASE){
      submitting=true;if(btn){btn.disabled=true;btn.dataset.label=btn.textContent;btn.textContent='Submitting\u2026';}
      const res=await fetch(API_BASE+'/public/website/applications',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok||body.ok!==true){throw new Error(body&&body.message?body.message:'submit_failed');}
      if(body.reference){
        success.querySelector('p').textContent='Your application reference is '+body.reference+'. Keep it for your records \u2014 our team will contact you shortly.';
      }
      idemKey=null; // this submission landed; a NEW application later gets a new key
      form.style.display='none';
      success.classList.add('show');
      success.scrollIntoView({behavior:'smooth',block:'center'});
    }else{
      // no backend yet: deliver the application to the salon inbox by email
      const url=window.apsBuildMailto(payload);
      success.querySelector('h3').textContent='One more step \u2014 press Send.';
      success.querySelector('p').textContent='Your email app just opened with your application filled in. Press Send to deliver it to our team.';
      document.getElementById('formSuccessNote').innerHTML='Email app didn\u2019t open? <a href="'+url+'">Tap here to send your application by email</a>.';
      form.style.display='none';
      success.classList.add('show');
      success.scrollIntoView({behavior:'smooth',block:'center'});
      try{window.location.href=url;}catch(_e){}
    }
  }catch(err2){
    // Honest failure: keep the form (and the visitor's typed data) on screen with a safe generic message —
    // never a fake success. Retrying re-sends the SAME idempotency key, so a late-landing first attempt can't duplicate.
    if(err){err.textContent='Something went wrong submitting your application. Please try again \u2014 or email us at nailsalon@aipowersalon.com.';err.style.display='block';err.scrollIntoView({behavior:'smooth',block:'center'});}
  }finally{
    submitting=false;if(btn){btn.disabled=false;if(btn.dataset.label)btn.textContent=btn.dataset.label;}
  }
});

// builds a mailto: link to the salon inbox from the application payload
window.apsBuildMailto=function(p){
  const nice=k=>k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const lines=['New POS Package Application',''];
  Object.entries(p).forEach(([k,v])=>{
    if(k==='source')return;
    const val=Array.isArray(v)?v.join(', '):(typeof v==='boolean'?(v?'Yes':'No'):String(v||'').trim());
    if(val!=='')lines.push(nice(k)+': '+val);
  });
  lines.push('','Sent from aipowersalon.com');
  const subject='New POS Package Application — '+(p.salon_name||'Salon');
  return 'mailto:nailsalon@aipowersalon.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(lines.join('\n'));
};