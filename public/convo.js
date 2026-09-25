const WORKER_URL='https://convo-api.atityaramsureshmanickam.workers.dev';
let currentPin=null,currentUser=null,currentChannels=[],activeChannel=null,hiddenPin='',superAdminMode=false,autoSubmitting=false,appLoading=false,messageSyncTimer=null,messageSyncInFlight=false,lastMessageSignature='',activePage=1,lastPage=1,replyTarget=null;
try{currentPin=localStorage.getItem('convo_active_pin')||null;currentUser=JSON.parse(localStorage.getItem('convo_user')||'null')}catch(e){console.warn('Convo storage unavailable; starting fresh',e)}
const $=id=>document.getElementById(id),messagePageMenu=$('messagePageMenu'),authForm=$('authForm'),pinInput=$('pinInput'),nameInput=$('nameInput'),newUserNameBlock=$('newUserNameBlock'),btnLogin=$('btnLogin'),btnLogout=$('btnLogout'),authOverlay=$('authOverlay'),accessCore=$('accessCore'),hudStatus=$('hudStatus'),hudHint=$('hudHint'),progressSegments=[...document.querySelectorAll('.hud-progress span')],btnPagePrev=$('btnPagePrev'),btnPageNext=$('btnPageNext'),messagePageIndicator=$('messagePageIndicator'),btnComposerPlus=$('btnComposerPlus'),fileInput=$('fileInput'),fileUploadQueue=$('fileUploadQueue'),btnRenameChannel=$('btnRenameChannel'),renameChannelModal=$('renameChannelModal'),renameChannelForm=$('renameChannelForm'),renameChannelInput=$('renameChannelInput'),renameChannelError=$('renameChannelError'),btnCancelRenameChannel=$('btnCancelRenameChannel'),btnSubmitRenameChannel=$('btnSubmitRenameChannel'),replyComposer=$('replyComposer'),replyComposerAuthor=$('replyComposerAuthor'),replyComposerText=$('replyComposerText'),replyComposerClose=$('replyComposerClose'),appBootScreen=$('appBootScreen'),appBootStatus=$('appBootStatus'),appBootDetail=$('appBootDetail'),appBootRetry=$('appBootRetry');
const esc=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const formatTime=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
function focusAccess(){pinInput.focus({preventScroll:true})}
async function api(path,options={}){const {timeoutMs=12000,...requestOptions}=options;const headers={...(requestOptions.headers||{})};if(requestOptions.body!==undefined&&!headers['Content-Type'])headers['Content-Type']='application/json';if(currentPin)headers['X-Convo-Pin']=currentPin;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetch(`${WORKER_URL}${path}`,{...requestOptions,headers,cache:'no-store',signal:requestOptions.signal||controller.signal}),t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}catch(err){if(err?.name==='AbortError'&&requestOptions.signal===undefined)throw new Error(`Request timed out after ${Math.round(timeoutMs/1000)}s.`);throw err}finally{clearTimeout(timer)}}
function showAppError(message){console.error(message);hudStatus.textContent='CONNECTION ERROR';hudHint.textContent='CHECK WORKER ACCESS'}
const CHANNEL_CACHE_KEY='convo_channel_cache_v1';
function readCachedChannels(){try{const parsed=JSON.parse(localStorage.getItem(CHANNEL_CACHE_KEY)||'[]');return Array.isArray(parsed)?parsed.filter(c=>c&&c.id&&c.name):[]}catch(e){return[]}}
function writeCachedChannels(channels){try{localStorage.setItem(CHANNEL_CACHE_KEY,JSON.stringify(channels))}catch(e){}}
function showAppBoot(status='LOADING CONVO',detail='Preparing your workspace…',retry=false){if(!appBootScreen)return;appBootStatus.textContent=status;appBootDetail.textContent=detail;appBootRetry.hidden=!retry;appBootScreen.hidden=false;appBootScreen.removeAttribute('hidden')}
function hideAppBoot(){if(!appBootScreen)return;appBootRetry.hidden=true;appBootScreen.hidden=true;appBootScreen.setAttribute('hidden','')}
appBootRetry?.addEventListener('click',()=>{appBootRetry.hidden=true;initApp(true)});
let superAdminHoldTimer=null,superAdminHoldActive=false,superAdminJArmed=false;
function bumpCore(className){accessCore.classList.remove('admin-bump','hold-bump');void accessCore.offsetWidth;accessCore.classList.add(className);setTimeout(()=>accessCore.classList.remove(className),420)}
function resetSuperAdminArming(){clearTimeout(superAdminHoldTimer);superAdminHoldTimer=null;superAdminHoldActive=false;superAdminJArmed=false;superAdminMode=false;authOverlay.classList.remove('super-mode')}
function armSuperAdminGesture(){if(superAdminHoldActive)return;superAdminHoldActive=true;superAdminJArmed=true;authOverlay.classList.add('super-mode');pinInput.type='text';pinInput.inputMode='text';pinInput.value='';hiddenPin='';hudStatus.textContent='ACCESS CORE ARMED';hudHint.textContent='';bumpCore('hold-bump');focusAccess()}
function cancelSuperAdminGesture(){clearTimeout(superAdminHoldTimer);superAdminHoldTimer=null}
function beginSuperAdminHold(e){if(superAdminMode)return;e.preventDefault();cancelSuperAdminGesture();superAdminHoldTimer=setTimeout(armSuperAdminGesture,3000)}
function endSuperAdminHold(){cancelSuperAdminGesture()}
accessCore.addEventListener('pointerdown',beginSuperAdminHold,{passive:false});['pointerup','pointercancel','pointerleave'].forEach(t=>accessCore.addEventListener(t,endSuperAdminHold,{passive:true}));accessCore.addEventListener('contextmenu',e=>e.preventDefault());
function confirmSuperAdminJ(){if(!superAdminJArmed||superAdminMode)return;superAdminMode=true;superAdminJArmed=false;pinInput.type='password';pinInput.inputMode='numeric';pinInput.value='';hiddenPin='';hudStatus.textContent='ACCESS CORE READY';hudHint.textContent='ENTER ACCESS CODE';bumpCore('admin-bump');focusAccess()}
window.addEventListener('keydown',e=>{if(e.code==='Escape'){e.preventDefault();hiddenPin='';pinInput.value='';pinInput.type='password';pinInput.inputMode='numeric';autoSubmitting=false;resetSuperAdminArming();authOverlay.classList.remove('super-mode','denied');hudStatus.textContent='ACCESS SYSTEM READY';hudHint.textContent='ENTER ACCESS CODE';updateHud();closeSuperAdminPanel();focusAccess();return}if(superAdminJArmed&&!superAdminMode&&(e.key==='j'||e.key==='J')){e.preventDefault();confirmSuperAdminJ()}});
pinInput.addEventListener('input',e=>{let value=String(e.target.value||'');if(superAdminJArmed&&!superAdminMode){if(value.toLowerCase().includes('j')){e.target.value='';confirmSuperAdminJ()}else e.target.value='';return}value=value.replace(/\D/g,'').slice(0,4);e.target.value=value;if(value!==hiddenPin){hiddenPin=value;autoSubmitting=false;authOverlay.classList.remove('denied');updateHud();if(hiddenPin.length===4&&!autoSubmitting){autoSubmitting=true;requestAnimationFrame(()=>authForm.requestSubmit())}}});
btnLogout.addEventListener('click',handleLogout);
function stopMessageSync(){if(messageSyncTimer!==null){clearInterval(messageSyncTimer);messageSyncTimer=null}messageSyncInFlight=false;lastMessageSignature=''}
function handleLogout(){hideAppBoot();stopMessageSync();closeChannelModal();closeRenameChannelModal();closeSuperAdminPanel();try{localStorage.removeItem('convo_active_pin');localStorage.removeItem('convo_user');sessionStorage.removeItem('convo_active_pin');sessionStorage.removeItem('convo_user')}catch(e){}currentPin=null;currentUser=null;currentChannels=[];activeChannel=null;hiddenPin='';resetSuperAdminArming();autoSubmitting=false;pinInput.value='';pinInput.type='password';pinInput.inputMode='numeric';nameInput.value='';newUserNameBlock.style.display='none';btnLogin.textContent='INITIALIZE';btnLogin.disabled=false;hudStatus.textContent='ACCESS SYSTEM READY';hudHint.textContent='ENTER ACCESS CODE';authOverlay.classList.remove('super-mode','granted','denied','checking');authOverlay.style.display='flex';updateHud();$('messagesFeed')?.replaceChildren();$('channelNavList')?.replaceChildren();$('userDisplayName').textContent='';$('btnDeleteGroup').style.display='none';$('btnCreateChannel').style.display='none';$('superAdminLauncher').hidden=true;requestAnimationFrame(focusAccess)}
function updateHud(){progressSegments.forEach((s,i)=>s.classList.toggle('filled',i<hiddenPin.length));accessCore.style.setProperty('--entry-progress',`${hiddenPin.length*25}%`)}
authForm.addEventListener('submit',e=>{e.preventDefault();login()});
accessCore.addEventListener('click',e=>{e.preventDefault();if(hiddenPin.length===4)authForm.requestSubmit();else focusAccess()});
async function login(){if(hiddenPin.length!==4){hudStatus.textContent='ACCESS CODE REQUIRED';authOverlay.classList.add('denied');autoSubmitting=false;focusAccess();return}const name=nameInput.value.trim(),isSuperAdmin=superAdminMode&&hiddenPin==='4999';try{btnLogin.textContent='VERIFYING';btnLogin.disabled=true;hudStatus.textContent=isSuperAdmin?'ACCESS CORE VERIFYING':'IDENTITY VERIFYING';hudHint.textContent='AUTHENTICATING';authOverlay.classList.remove('denied');authOverlay.classList.add('checking');const r=await fetch(`${WORKER_URL}/auth`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:hiddenPin,name,isSuperAdmin})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Authentication failed');if(d.isNew&&!name&&newUserNameBlock.style.display==='none'){newUserNameBlock.style.display='block';btnLogin.textContent='COMPLETE IDENTITY';btnLogin.disabled=false;hudStatus.textContent='NEW IDENTITY DETECTED';hudHint.textContent='ENTER DISPLAY NAME';authOverlay.classList.remove('checking');autoSubmitting=false;nameInput.focus();return}currentPin=d.assignedPin||hiddenPin;currentUser=d.user;try{localStorage.setItem('convo_active_pin',currentPin);localStorage.setItem('convo_user',JSON.stringify(currentUser))}catch(e){}hudStatus.textContent=d.assignedPin?'IDENTITY CREATED':'ACCESS GRANTED';hudHint.textContent=d.assignedPin?`NEW PIN: ${d.assignedPin}`:(isSuperAdmin?'SUPER ADMIN CORE ONLINE':'IDENTITY VERIFIED');authOverlay.classList.remove('checking','denied');authOverlay.classList.add('granted');setTimeout(()=>{authOverlay.style.display='none';showAppBoot('LOADING CONVO','Syncing your team channels…');initApp()},d.assignedPin?1800:360)}catch(err){console.error(err);hudStatus.textContent='ACCESS DENIED';hudHint.textContent='TRY AGAIN';authOverlay.classList.remove('checking','granted');authOverlay.classList.add('denied');btnLogin.textContent='INITIALIZE';autoSubmitting=false;hiddenPin='';pinInput.value='';updateHud();alert(err.message||'Failed to connect to authentication server.');focusAccess()}finally{btnLogin.disabled=false}}
async function loadChannels(preferredName=null,select=true){if(!currentChannels.length){const cached=readCachedChannels();if(cached.length){currentChannels=cached;renderChannels()}}let networkError=null;try{const d=await api('/channels',{timeoutMs:10000});if(Array.isArray(d.channels)&&d.channels.length){currentChannels=d.channels;writeCachedChannels(currentChannels);renderChannels()}}catch(err){networkError=err;console.warn('Channel sync failed; using cached channels when available.',err)}const targetName=preferredName||activeChannel?.name||'general',target=currentChannels.find(c=>c.name===targetName)||currentChannels[0];if(select&&target)await selectChannel(target.name,false);if(networkError&&!target)throw networkError;return target}
function renderChannels(){const list=$('channelNavList');list.replaceChildren();const canManageChannel=['admin','superadmin'].includes(currentUser?.role);currentChannels.forEach(channel=>{const row=document.createElement('div');row.className='channel-item-row';const b=document.createElement('button');b.type='button';b.className='channel-item'+(activeChannel?.id===channel.id?' active':'');b.textContent=`# ${channel.name}`;b.title=channel.description||channel.name;b.addEventListener('click',()=>selectChannel(channel.name));row.appendChild(b);if(canManageChannel&&channel.name!=='general'){const del=document.createElement('button');del.type='button';del.className='channel-delete';del.setAttribute('aria-label',`Delete #${channel.name}`);del.title=`Delete #${channel.name}`;del.textContent='×';del.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();activeChannel?.id===channel.id?window.deleteCurrentGroup():deleteChannelById(channel.id)});row.appendChild(del)}list.appendChild(row)})}
function getMessageSignature(messages){return JSON.stringify(messages.map(m=>[m.id,m.channelId,m.pin,m.author,m.role,m.text,m.quotedMessage?.id,m.time||m.createdAt]));}
function pageStorageKey(channel){return `convo_active_page_${channel?.id||channel?.name||'general'}`;}
function renderPageMenu(){
  if(!messagePageMenu)return;
  messagePageMenu.replaceChildren();
  for(let page=1;page<=lastPage;page++){
    const button=document.createElement('button');
    button.type='button';
    button.className='message-page-option'+(page===activePage?' active':'');
    button.setAttribute('role','option');
    button.setAttribute('aria-selected',page===activePage?'true':'false');
    button.dataset.page=String(page);
    button.textContent=String(page);
    button.addEventListener('click',async e=>{e.stopPropagation();closePageMenu();await selectMessagePage(page)});
    messagePageMenu.appendChild(button);
  }
}
function handlePageContextMenu(e){
  const option=e.target.closest('.message-page-option');
  if(!option||!messagePageMenu.contains(option))return;
  e.preventDefault();
  e.stopPropagation();
  const page=Number(option.dataset.page);
  closePageMenu();
  deleteMessagePage(page);
}
messagePageMenu?.addEventListener('contextmenu',handlePageContextMenu);
messagePageMenu?.addEventListener('pointerdown',e=>{
  if(e.button!==2)return;
  const option=e.target.closest('.message-page-option');
  if(!option)return;
  e.preventDefault();
  e.stopPropagation();
  closePageMenu();
  deleteMessagePage(Number(option.dataset.page));
});
messagePageIndicator?.addEventListener('contextmenu',e=>{
  e.preventDefault();
  e.stopPropagation();
  closePageMenu();
  deleteMessagePage(activePage);
});
messagePageIndicator?.addEventListener('pointerdown',e=>{
  if(e.button!==2)return;
  e.preventDefault();
  e.stopPropagation();
  closePageMenu();
  deleteMessagePage(activePage);
});
document.querySelector('.message-page-controls')?.addEventListener('contextmenu',e=>{
  if(e.target.closest('.message-page-option,.page-nav-btn'))return;
  if(!e.target.closest('#messagePageIndicator'))return;
  e.preventDefault();
  e.stopPropagation();
  closePageMenu();
  deleteMessagePage(activePage);
});
function closePageMenu(){
  if(!messagePageMenu)return;
  messagePageMenu.hidden=true;
  messagePageIndicator?.setAttribute('aria-expanded','false');
}
function togglePageMenu(){
  if(!messagePageMenu)return;
  if(messagePageMenu.hidden){
    renderPageMenu();
    messagePageMenu.hidden=false;
    messagePageIndicator?.setAttribute('aria-expanded','true');
  }else closePageMenu();
}
function updatePageControls(){
  if(messagePageIndicator)messagePageIndicator.textContent=String(activePage);
  renderPageMenu();
  if(btnPagePrev)btnPagePrev.disabled=activePage<=1;
  if(btnPageNext)btnPageNext.disabled=activePage>=lastPage&&lastMessageSignature==='[]';
}
function saveActivePage(){
  try{if(activeChannel)localStorage.setItem(pageStorageKey(activeChannel),String(activePage))}catch(e){}
}
async function loadChannelPages(channel){
  const d=await api(`/pages?channel=${encodeURIComponent(channel.name)}`);
  const pages=Array.isArray(d.pages)?d.pages:[];
  lastPage=Math.max(1,Number(d.lastPage)||pages.length||1);
  let saved=0;
  try{saved=Number(localStorage.getItem(pageStorageKey(channel))||0)}catch(e){}
  activePage=saved>=1&&saved<=lastPage?saved:lastPage;
  saveActivePage();
  updatePageControls();
}
function getChatScrollArea(){
  return document.querySelector('.chat-scroll-area');
}
function scrollMessagesToBottom(behavior='auto'){
  const area=getChatScrollArea();
  if(!area)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    area.scrollTo({top:area.scrollHeight,behavior});
  }));
}
async function loadActivePage(preserveScroll=false){
  if(!activeChannel)return;
  const area=getChatScrollArea();
  stopMessageSync();
  lastMessageSignature='';
  const previousScroll=area?.scrollTop||0;
  try{
    const d=await api(`/messages?channel=${encodeURIComponent(activeChannel.name)}&page=${encodeURIComponent(activePage)}&sync=1`);
    const messages=Array.isArray(d.messages)?d.messages:[];
    lastMessageSignature=getMessageSignature(messages);
    renderMessages(messages);
    if(preserveScroll&&area)area.scrollTop=previousScroll;
    else scrollMessagesToBottom();
  }catch(err){
    $('messagesFeed').innerHTML='<div class="state-message">Unable to load this page.</div>';
    showAppError(err);
    return false;
  }
  updatePageControls();
  startMessageSync();
  return true;
}
async function syncActiveMessages(preserveScroll=true){
  if(!currentUser||!activeChannel||messageSyncInFlight)return;
  messageSyncInFlight=true;
  try{
    const d=await api(`/messages?channel=${encodeURIComponent(activeChannel.name)}&page=${encodeURIComponent(activePage)}&sync=1`);
    const messages=Array.isArray(d.messages)?d.messages:[];
    const signature=getMessageSignature(messages);
    if(signature!==lastMessageSignature){
      const area=getChatScrollArea();
      const previousScroll=area?.scrollTop||0;
      const wasAtBottom=area?area.scrollHeight-area.scrollTop-area.clientHeight<48:true;
      lastMessageSignature=signature;
      renderMessages(messages);
      updatePageControls();
      if(preserveScroll){
        if(wasAtBottom)scrollMessagesToBottom();
        else if(area)area.scrollTop=previousScroll;
      }else{
        scrollMessagesToBottom();
      }
    }
  }catch(err){console.warn('Background message sync failed.',err)}
  finally{messageSyncInFlight=false}
}

function startMessageSync(){stopMessageSync();messageSyncTimer=setInterval(()=>syncActiveMessages(true),3000)}
async function deleteMessagePage(page){
  if(!activeChannel||lastPage<=1)return;
  const target=Math.max(1,Number(page)||0);
  if(!target||target>lastPage)return;
  if(!confirm(`Delete message page ${target}? All messages on this page will also be deleted.`))return;
  try{
    await api('/pages/delete',{method:'POST',body:JSON.stringify({channel:activeChannel.name,page:target})});
    const remaining=lastPage-1;
    lastPage=Math.max(1,remaining);
    if(activePage===target)activePage=Math.min(target,lastPage);
    else if(activePage>target)activePage-=1;
    saveActivePage();
    updatePageControls();
    await loadActivePage(false);
  }catch(err){
    alert(err.message||'Unable to delete this message page.');
  }
}
async function selectMessagePage(page){
  if(!activeChannel)return;
  const target=Math.max(1,Math.min(lastPage,Number(page)||1));
  if(target===activePage){updatePageControls();return}
  activePage=target;
  saveActivePage();
  await loadActivePage(false);
}
async function nextMessagePage(){
  if(!activeChannel)return;
  if(activePage<lastPage){await selectMessagePage(activePage+1);return}
  try{
    const d=await api('/pages',{method:'POST',body:JSON.stringify({channel:activeChannel.name})});
    const created=Number(d.page?.page);
    if(!created)return;
    lastPage=Math.max(lastPage,created);
    activePage=created;
    saveActivePage();
    updatePageControls();
    await loadActivePage(false);
  }catch(err){alert(err.message||'Unable to create the next message page.')}
}
async function selectChannel(channelName,reportActivity=true){
  const channel=currentChannels.find(c=>c.name===channelName);
  if(!channel)return;
  stopMessageSync();
  activeChannel=channel;
  clearReplyTarget();
  $('activeChannelHeading').textContent=`# ${channel.name}`;
  $('activeChannelDesc').textContent=channel.description||'Project discussion';
  const canManageChannel=['admin','superadmin'].includes(currentUser?.role);
  if(btnRenameChannel){
    btnRenameChannel.hidden=!canManageChannel||channel.name==='general';
  }
  $('btnDeleteGroup').style.display=channel.name==='general'||!canManageChannel?'none':'inline-flex';
  renderChannels();
  $('messagesFeed').innerHTML='<div class="state-message">Loading messages...</div>';
  try{
    await loadChannelPages(channel);
    const loaded=await loadActivePage(false);
    if(!loaded)return;
  }catch(err){
    $('messagesFeed').innerHTML='<div class="state-message">Unable to load this channel.</div>';
    showAppError(err);
    return;
  }
  if(reportActivity){
    try{await api('/activity',{method:'POST',body:JSON.stringify({channel:channel.name,action:'VIEWED'})})}
    catch(err){console.warn('Channel activity logging failed; messages remain visible.',err)}
  }
}
btnPagePrev?.addEventListener('click',()=>selectMessagePage(activePage-1));
btnPageNext?.addEventListener('click',()=>nextMessagePage());
messagePageIndicator?.addEventListener('click',e=>{e.stopPropagation();togglePageMenu()});
document.addEventListener('click',e=>{if(!e.target.closest('.message-page-controls'))closePageMenu()});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closePageMenu()});
updatePageControls();
function replyPreviewText(message){
  const text=String(message?.text||'').replace(/\s+/g,' ').trim();
  return text||((message?.files&&message.files.length)?'Attachment':'Message');
}
function clearReplyTarget(){
  replyTarget=null;
  if(replyComposer){replyComposer.hidden=true;replyComposer.setAttribute('hidden','');}
  if(replyComposerAuthor)replyComposerAuthor.textContent='';
  if(replyComposerText)replyComposerText.textContent='';
}
function setReplyTarget(message){
  if(!message?.id)return;
  replyTarget={id:Number(message.id),author:String(message.author||'Unknown'),text:String(message.text||''),files:Array.isArray(message.files)?message.files:[]};
  if(replyComposerAuthor)replyComposerAuthor.textContent=replyTarget.author;
  if(replyComposerText)replyComposerText.textContent=replyPreviewText(replyTarget);
  if(replyComposer){replyComposer.hidden=false;replyComposer.removeAttribute('hidden');}
  requestAnimationFrame(()=>{const input=$('msgInput');input?.focus({preventScroll:true});});
}
function resetMessageSwipe(article){
  article.classList.remove('swiping');
  article.style.transform='';
}
function bindMessageSwipe(article,message){
  let startX=0,startY=0,active=false,blocked=false,moved=false,pointerId=null;
  const reset=()=>{if(pointerId!==null){try{if(article.hasPointerCapture?.(pointerId))article.releasePointerCapture(pointerId)}catch(e){}}pointerId=null;active=false;blocked=false;moved=false;resetMessageSwipe(article)};
  article.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button,a,input,textarea,select,[contenteditable="true"]'))return;
    startX=e.clientX;startY=e.clientY;active=true;blocked=false;moved=false;pointerId=e.pointerId;
  });
  article.addEventListener('pointermove',e=>{
    if(!active||blocked)return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(!moved){
      if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){blocked=true;return;}
      if(Math.abs(dx)<8)return;
      moved=true;
      article.classList.add('swiping');
      try{article.setPointerCapture(pointerId)}catch(err){}
    }
    const distance=Math.max(-110,Math.min(110,dx));
    article.style.transform='translateX('+distance+'px)';
    if(Math.abs(dx)>10)e.preventDefault();
  },{passive:false});
  article.addEventListener('pointerup',e=>{
    if(!active)return;
    const dx=e.clientX-startX;
    if(moved&&Math.abs(dx)>=60){
      const target=message;
      reset();
      setReplyTarget(target);
      return;
    }
    reset();
  });
  article.addEventListener('pointercancel',reset);
  article.addEventListener('lostpointercapture',()=>{if(active)reset()});
}
function renderMessages(messages){
  const feed=$('messagesFeed');
  feed.replaceChildren();
  if(!messages.length){
    const e=document.createElement('div');
    e.className='state-message';
    e.textContent='No messages yet. Start the conversation.';
    feed.appendChild(e);
    updateFileExpiryTimers();
    return
  }
  messages.forEach(message=>{
    const article=document.createElement('article');
    article.className='message-card';
    const own=currentUser&&message.pin===currentUser.pin,
      canDelete=currentUser&&(currentUser.role==='superadmin'||own||(currentUser.role==='admin'&&message.role==='user'));
    const files=Array.isArray(message.files)?message.files:[];
    const fileHtml=files.map(file=>{
      const image=String(file.mimeType||'').startsWith('image/');
      return `<div class="shared-file${image?' shared-image-file':''}">
        <div class="shared-file-top">
          <div class="shared-file-main"><div class="shared-file-icon">FILE</div><div class="shared-file-copy"><strong>${esc(file.fileName||'file')}</strong><span>${esc(formatFileSize(file.fileSize))}</span></div></div>
          <div class="shared-file-actions"><span class="file-expiry" data-expires-at="${esc(file.expiresAt||'')}"></span><button type="button" class="file-download" data-attachment-id="${Number(file.id)}">Download</button></div>
        </div>
        ${image?`<div class="shared-file-image-wrap" data-image-attachment-id="${Number(file.id)}"><span class="file-preview-loading">Loading preview…</span><img class="shared-file-image" alt="${esc(file.fileName||'Image preview')}" data-image-id="${Number(file.id)}" loading="eager" decoding="async" hidden></div>`:''}
      </div>`;
    }).join('');
    const textHtml=String(message.text||'')?`<div class="message-text">${esc(message.text)}</div>`:'';
    const quoted=message.quotedMessage;
    const quotedHtml=quoted?`<div class="message-reply-preview"><span class="message-reply-author">${esc(quoted.author||'Unknown')}</span><span class="message-reply-text">${esc(replyPreviewText(quoted))}</span></div>`:'';
    article.innerHTML=`<div class="message-meta"><strong>${esc(message.author||'Unknown')}</strong><span>${esc(message.role||'user')}</span><time>${esc(formatTime(message.time||message.createdAt))}</time></div>${quotedHtml}${textHtml}${fileHtml}${canDelete?`<button type="button" class="message-delete" data-message-id="${Number(message.id)}">Delete</button>`:''} `;
    const del=article.querySelector('.message-delete');
    if(del)del.addEventListener('click',()=>deleteMessage(message.id));
    article.querySelectorAll('.file-download').forEach(button=>button.addEventListener('click',()=>downloadAttachment(Number(button.dataset.attachmentId),button)));
    article.querySelectorAll('.shared-file-image[data-image-id]').forEach(image=>{
      loadImagePreview(Number(image.dataset.imageId),image,image.closest('.shared-file-image-wrap'));
    });
    bindMessageSwipe(article,message);
    feed.appendChild(article)
  });
  updateFileExpiryTimers();
}
function formatFileSize(bytes){
  const value=Number(bytes)||0;
  if(value<1024)return `${value} B`;
  const units=['KB','MB','GB','TB'];
  let size=value;
  let index=-1;
  do{size/=1024;index++}while(size>=1024&&index<units.length-1);
  return `${size.toFixed(size>=10?0:1)} ${units[index]}`;
}

function formatFileCountdown(milliseconds){
  const total=Math.max(0,Math.ceil(milliseconds/1000));
  const hours=Math.floor(total/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function updateFileExpiryTimers(){
  document.querySelectorAll('.file-expiry[data-expires-at]').forEach(timer=>{
    const expires=Date.parse(timer.dataset.expiresAt||'');
    const card=timer.closest('.shared-file');
    const button=card?.querySelector('.file-download');
    if(!Number.isFinite(expires))return;
    const remaining=expires-Date.now();
    if(remaining<=0){
      timer.textContent='Expired';
      timer.classList.add('expired');
      if(button){button.disabled=true;button.textContent='Expired'}
      const image=card?.querySelector('.shared-file-image');
      if(image){
        image.removeAttribute('src');
        image.hidden=true;
        card.querySelector('.shared-file-image-wrap')?.classList.add('expired');
      }
      return
    }
    timer.textContent=formatFileCountdown(remaining);
    timer.classList.remove('expired');
    if(button){button.disabled=false;button.textContent='Download'}
  });
}

async function loadImagePreview(id,image,wrap){
  if(!id||!image)return;
  try{
    const d=await api(`/files/access?id=${encodeURIComponent(id)}`);
    if(!d.url)throw new Error('Unable to prepare image preview.');
    image.addEventListener('load',()=>{
      image.hidden=false;
      wrap?.classList.remove('loading');
      wrap?.querySelector('.file-preview-loading')?.remove();
    },{once:true});
    image.addEventListener('error',()=>{
      image.hidden=true;
      wrap?.classList.add('failed');
      const label=wrap?.querySelector('.file-preview-loading');
      if(label)label.textContent='Preview unavailable';
    },{once:true});
    wrap?.classList.add('loading');
    image.src=d.url;
  }catch(err){
    image.hidden=true;
    wrap?.classList.add('failed');
    const label=wrap?.querySelector('.file-preview-loading');
    if(label)label.textContent='Preview unavailable';
  }
}

async function downloadAttachment(id,button){
  if(!id||button?.disabled)return;
  const original=button?.textContent||'Download';
  if(button){button.disabled=true;button.textContent='Preparing…'}
  try{
    const d=await api(`/files/access?id=${encodeURIComponent(id)}`);
    if(!d.url)throw new Error('Unable to prepare the file download.');
    window.location.href=d.url;
  }catch(err){
    if(button){button.disabled=false;button.textContent=original}
    alert(err.message||'Unable to download file.')
  }
}

function createUploadEntry(file){
  const row=document.createElement('div');
  row.className='file-upload-row';
  const main=document.createElement('div');
  main.className='file-upload-main';
  const name=document.createElement('strong');
  name.className='file-upload-name';
  name.textContent=file.name;
  const size=document.createElement('span');
  size.className='file-upload-size';
  size.textContent=formatFileSize(file.size);
  main.append(name,size);
  const status=document.createElement('span');
  status.className='file-upload-status';
  status.textContent='Queued';
  const track=document.createElement('div');
  track.className='file-upload-track';
  const bar=document.createElement('span');
  bar.className='file-upload-bar';
  track.appendChild(bar);
  const right=document.createElement('div');
  right.className='file-upload-right';
  right.append(status);
  row.append(main,right,track);
  fileUploadQueue.appendChild(row);
  fileUploadQueue.hidden=false;
  return {row,status,bar}
}

function setUploadState(entry,label,percent,failed=false){
  entry.status.textContent=label;
  entry.bar.style.width=`${Math.max(0,Math.min(100,percent))}%`;
  entry.row.classList.toggle('failed',failed);
}

function uploadFileWithProgress(file,channelName,pageNumber,pin,isSuperAdmin,entry){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST',`${WORKER_URL}/files`,true);
    xhr.responseType='text';
    xhr.timeout=30*60*1000;
    xhr.upload.addEventListener('progress',event=>{
      const percent=event.lengthComputable?Math.round((event.loaded/event.total)*100):0;
      setUploadState(entry,`Uploading ${percent}%`,percent);
    });
    xhr.onload=()=>{
      let data={};
      try{data=xhr.responseText?JSON.parse(xhr.responseText):{}}catch{data={error:xhr.responseText}}
      if(xhr.status>=200&&xhr.status<300){
        setUploadState(entry,'Posted',100);
        resolve(data);
      }else{
        reject(new Error(data.error||`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror=()=>reject(new Error('Network error while uploading file.'));
    xhr.ontimeout=()=>reject(new Error('File upload timed out.'));
    if(pin)xhr.setRequestHeader('X-Convo-Pin',pin);
    if(isSuperAdmin&&pin==='4999')xhr.setRequestHeader('X-Convo-SuperAdmin','true');
    const form=new FormData();
    form.append('channel',channelName);
    form.append('page',String(pageNumber));
    form.append('file',file,file.name);
    setUploadState(entry,'Uploading 0%',0);
    xhr.send(form);
  });
}

async function uploadSelectedFiles(files){
  if(!currentUser||!activeChannel||!fileUploadQueue)return;
  const channelName=activeChannel.name;
  const pageNumber=activePage;
  const pin=currentPin;
  const isSuperAdmin=currentUser.role==='superadmin'&&pin==='4999';
  const entries=[...files].map(createUploadEntry);
  const maxSize=50*1024*1024;
  await Promise.all(entries.map(async(entry,index)=>{
    const file=files[index];
    if(Number(file.size)>maxSize){
      setUploadState(entry,'Failed • over 50 MB',0,true);
      return
    }
    try{
      await uploadFileWithProgress(file,channelName,pageNumber,pin,isSuperAdmin,entry);
      await syncActiveMessages(true);
      setTimeout(()=>{
        entry.row.remove();
        if(!fileUploadQueue.children.length)fileUploadQueue.hidden=true;
      },1200);
    }catch(err){
      setUploadState(entry,err.message||'Upload failed.',0,true);
    }
  }));
  await syncActiveMessages(true);
  updatePageControls();
}

btnComposerPlus?.addEventListener('click',()=>{if(currentUser)fileInput?.click()});
fileInput?.addEventListener('change',()=>{
  const files=[...(fileInput.files||[])];
  fileInput.value='';
  if(files.length)uploadSelectedFiles(files);
});
msgInput?.addEventListener('paste',e=>{
  if(!currentUser||!activeChannel)return;
  const items=[...(e.clipboardData?.items||[])];
  const imageItems=items.filter(item=>item.kind==='file'&&String(item.type||'').startsWith('image/'));
  if(!imageItems.length)return;
  e.preventDefault();
  const files=imageItems.map((item,index)=>{
    const blob=item.getAsFile();
    if(!blob)return null;
    const type=blob.type||'image/png';
    const ext=(type.split('/')[1]||'png').split(';')[0].replace('jpeg','jpg');
    return new File([blob],`pasted-image-${Date.now()}-${index+1}.${ext}`,{type});
  }).filter(Boolean);
  if(files.length)uploadSelectedFiles(files);
});

let fileExpiryTimer=setInterval(updateFileExpiryTimers,1000);
updateFileExpiryTimers();

async function deleteMessage(id){if(!confirm('Delete this message?'))return;try{await api('/messages/delete',{method:'POST',body:JSON.stringify({id})});await syncActiveMessages(true)}catch(err){alert(err.message||'Unable to delete message.')}}
const messageContextMenu=document.createElement('div');messageContextMenu.className='message-context-menu';messageContextMenu.hidden=true;messageContextMenu.innerHTML='<button type="button" class="message-context-copy">Copy Message</button>';document.body.appendChild(messageContextMenu);let contextCopyText='';function closeMessageContextMenu(){messageContextMenu.hidden=true;contextCopyText=''}async function copyContextMessage(){const text=contextCopyText;if(!text){closeMessageContextMenu();return}try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy')}catch{}area.remove()}closeMessageContextMenu()}document.addEventListener('contextmenu',event=>{const article=event.target.closest('#messagesFeed .message-card');if(!article)return;const text=article.querySelector('.message-text')?.textContent||'';if(!text)return;event.preventDefault();contextCopyText=text;messageContextMenu.hidden=false;const w=132,h=42,left=Math.min(event.clientX,innerWidth-w-8),top=Math.min(event.clientY,innerHeight-h-8);messageContextMenu.style.left=`${Math.max(8,left)}px`;messageContextMenu.style.top=`${Math.max(8,top)}px`});messageContextMenu.querySelector('.message-context-copy').addEventListener('click',copyContextMessage);document.addEventListener('click',e=>{if(!messageContextMenu.contains(e.target))closeMessageContextMenu()});window.addEventListener('keydown',e=>{if(e.key==='Escape')closeMessageContextMenu()});window.addEventListener('scroll',closeMessageContextMenu,true);window.addEventListener('resize',closeMessageContextMenu);window.handlePostMessage=async function(){if(!currentUser||!activeChannel)return;const input=$('msgInput'),text=input.value.replace(/\r\n/g,'\n').replace(/\r/g,'\n');if(!text.trim())return;const button=document.querySelector('.btn-send');input.disabled=true;if(button)button.disabled=true;try{await api('/messages',{method:'POST',body:JSON.stringify({channel:activeChannel.name,page:activePage,text,quotedMessageId:replyTarget?.id||null})});input.value='';input.style.height='';clearReplyTarget();await syncActiveMessages(false);updatePageControls();scrollMessagesToBottom('smooth')}catch(err){alert(err.message||'Unable to post message.')}finally{input.disabled=false;if(button)button.disabled=false;requestAnimationFrame(()=>{input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length)})}};
replyComposerClose?.addEventListener('click',()=>{clearReplyTarget();$('msgInput')?.focus({preventScroll:true})});
const msgInput=$('msgInput');
msgInput?.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    window.handlePostMessage();
  }
});
msgInput?.addEventListener('input',()=>{
  msgInput.style.height='auto';
  msgInput.style.height=Math.min(msgInput.scrollHeight,120)+'px';
});

const channelModal=$('channelModal'),channelForm=$('channelForm'),channelNameInput=$('channelNameInput'),channelDescriptionInput=$('channelDescriptionInput'),channelModalError=$('channelModalError'),btnSubmitChannel=$('btnSubmitChannel');
function closeChannelModal(){channelModal.hidden=true;channelForm.reset();channelModalError.textContent='';btnSubmitChannel.disabled=false;btnSubmitChannel.textContent='Create'}
function closeRenameChannelModal(){
  if(!renameChannelModal)return;
  renameChannelModal.hidden=true;
  renameChannelForm?.reset();
  if(renameChannelError)renameChannelError.textContent='';
  if(btnSubmitRenameChannel){
    btnSubmitRenameChannel.disabled=false;
    btnSubmitRenameChannel.textContent='Save';
  }
}
function openRenameChannelModal(){
  if(!activeChannel||!['admin','superadmin'].includes(currentUser?.role)||activeChannel.name==='general')return;
  renameChannelModal.hidden=false;
  renameChannelModal.removeAttribute('hidden');
  renameChannelError.textContent='';
  renameChannelInput.value=activeChannel.name;
  requestAnimationFrame(()=>{renameChannelInput.focus();renameChannelInput.select()});
}
btnRenameChannel?.addEventListener('click',openRenameChannelModal);
btnCancelRenameChannel?.addEventListener('click',closeRenameChannelModal);
document.querySelector('[data-close-rename-channel]')?.addEventListener('click',closeRenameChannelModal);
renameChannelForm?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!activeChannel||!['admin','superadmin'].includes(currentUser?.role)||activeChannel.name==='general')return;
  const name=renameChannelInput.value.trim();
  if(!name){
    renameChannelError.textContent='Channel name is required.';
    renameChannelInput.focus();
    return;
  }
  btnSubmitRenameChannel.disabled=true;
  btnSubmitRenameChannel.textContent='Saving...';
  renameChannelError.textContent='';
  try{
    const d=await api(`/channels?id=${encodeURIComponent(activeChannel.id)}`,{
      method:'PUT',
      body:JSON.stringify({name})
    });
    closeRenameChannelModal();
    await loadChannels(d.channel?.name||name.toLowerCase());
  }catch(err){
    renameChannelError.textContent=err.message||'Unable to rename channel.';
    btnSubmitRenameChannel.disabled=false;
    btnSubmitRenameChannel.textContent='Save';
  }
});
function openChannelModal(){
  if(!currentUser)return;
  channelModal.hidden=false;
  channelModal.removeAttribute('hidden');
  channelModalError.textContent='';
  requestAnimationFrame(()=>channelNameInput.focus());
}
window.createCustomGroup=openChannelModal;
$('btnCreateChannel')?.addEventListener('click',e=>{e.preventDefault();openChannelModal()});
channelForm.addEventListener('submit',async e=>{e.preventDefault();if(!currentUser)return;const name=channelNameInput.value.trim(),description=channelDescriptionInput.value.trim()||'Project discussion';if(!name){channelModalError.textContent='Channel name is required.';channelNameInput.focus();return}btnSubmitChannel.disabled=true;btnSubmitChannel.textContent='Creating...';channelModalError.textContent='';try{const d=await api('/channels',{method:'POST',body:JSON.stringify({name,description})});closeChannelModal();await loadChannels(d.channel?.name||name.trim().toLowerCase())}catch(err){channelModalError.textContent=err.message||'Unable to create channel.';btnSubmitChannel.disabled=false;btnSubmitChannel.textContent='Create'}});$('btnCancelChannel').addEventListener('click',closeChannelModal);document.querySelector('[data-close-channel-modal]').addEventListener('click',closeChannelModal);
async function deleteChannelById(channelId){const channel=currentChannels.find(c=>c.id===channelId);if(!channel||channel.name==='general'||!['admin','superadmin'].includes(currentUser?.role))return;if(!confirm(`Delete #${channel.name} and its messages?`))return;try{await api('/channels/delete',{method:'POST',body:JSON.stringify({id:channel.id})});if(activeChannel?.id===channel.id)activeChannel=null;await loadChannels(activeChannel?.name||'general')}catch(err){alert(err.message||'Unable to delete channel.')}};
window.deleteCurrentGroup=async function(){if(!activeChannel||activeChannel.name==='general'||!['admin','superadmin'].includes(currentUser?.role))return;await deleteChannelById(activeChannel.id)};
async function loadAdminUsers(){if(currentUser?.role!=='superadmin')return;const rows=$('adminUserRows');rows.innerHTML='<div class="state-message">Loading authority data...</div>';try{const d=await api('/users'),users=Array.isArray(d.users)?d.users:[];rows.replaceChildren();users.forEach(user=>{const row=document.createElement('div');row.className='admin-user-row';row.innerHTML=`<span class="admin-user-main"><strong>${esc(user.name)}</strong><small>PIN ${esc(user.pin)}</small></span><span class="admin-user-role">${esc(user.role)}</span>${user.pin!==currentUser.pin?`<button type="button" class="btn-ctrl" data-pin="${esc(user.pin)}" data-role="${esc(user.role==='admin'?'user':'admin')}">${user.role==='admin'?'Make User':'Make Admin'}</button>`:''}`;const action=row.querySelector('button');if(action)action.addEventListener('click',()=>changeUserRole(action.dataset.pin,action.dataset.role));rows.appendChild(row)})}catch(err){rows.innerHTML='<div class="state-message">Authority data unavailable.</div>';showAppError(err)}}
async function changeUserRole(pin,role){try{await api('/users/role',{method:'PUT',body:JSON.stringify({pin,role})});await loadAdminUsers();await loadAdminAnalytics()}catch(err){alert(err.message||'Unable to change user role.')}}
async function loadAdminAnalytics(){if(currentUser?.role!=='superadmin')return;try{const d=await api('/analytics'),s=d.stats||{};$('superAdminStats').innerHTML=`<div><b>${Number(s.totalUsers||0)}</b><span>Users</span></div><div><b>${Number(s.totalAdmins||0)}</b><span>Admins</span></div><div><b>${Number(s.totalMessages||0)}</b><span>Messages</span></div><div><b>${Number(s.activeUsers||0)}</b><span>Active</span></div>`;$('superAdminActivity').innerHTML=`<div><span>Channels</span><b>${Number(s.totalChannels||0)}</b></div><div><span>Active channels</span><b>${Number(s.activeChannels||0)}</b></div><div><span>Views</span><b>${Number(s.totalViews||0)}</b></div><div><span>Generated</span><b>${esc(formatTime(d.generatedAt))}</b></div>`}catch(err){$('superAdminActivity').textContent='Analytics unavailable.';console.error(err)}}
const superAdminLauncher=$('superAdminLauncher'),superAdminPanel=$('superAdminPanel');
function openSuperAdminPanel(){if(currentUser?.role!=='superadmin')return;superAdminPanel.classList.add('open');superAdminPanel.setAttribute('aria-hidden','false');loadAdminUsers();loadAdminAnalytics()}
function closeSuperAdminPanel(){superAdminPanel.classList.remove('open');superAdminPanel.setAttribute('aria-hidden','true')}
superAdminLauncher.addEventListener('click',()=>superAdminPanel.classList.contains('open')?closeSuperAdminPanel():openSuperAdminPanel());$('superPanelClose').addEventListener('click',closeSuperAdminPanel);$('superPanelRefresh').addEventListener('click',()=>{loadAdminUsers();loadAdminAnalytics()});
async function initApp(force=false){if(!currentUser||appLoading&&!force)return;appLoading=true;$('userDisplayName').textContent=currentUser.name||'';$('btnCreateChannel').style.display='inline-flex';$('superAdminLauncher').hidden=currentUser.role!=='superadmin';closeSuperAdminPanel();showAppBoot('LOADING CONVO','Syncing your team channels…');try{const target=await loadChannels(null,false);hideAppBoot();if(target)await selectChannel(target.name,false);if(currentUser.role==='superadmin'){Promise.allSettled([loadAdminUsers(),loadAdminAnalytics()])}}catch(err){console.error(err);if(currentChannels.length){hideAppBoot();const target=currentChannels.find(c=>c.name===(activeChannel?.name||'general'))||currentChannels[0];if(target)selectChannel(target.name,false)}else{showAppBoot('CONVO UNAVAILABLE','Unable to reach the workspace service. Tap Retry to reconnect.',true)}}finally{appLoading=false}}
if(currentPin&&currentUser){authOverlay.style.display='none';showAppBoot();initApp()}else{hideAppBoot();authOverlay.style.display='flex';requestAnimationFrame(focusAccess)}