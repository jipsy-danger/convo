const WORKER_URL='https://convo-api.atityaramsureshmanickam.workers.dev';
let currentPin=null,currentUser=null,currentChannels=[],activeChannel=null,hiddenPin='',superAdminMode=false,autoSubmitting=false,appLoading=false,messageSyncTimer=null,messageSyncInFlight=false,lastMessageSignature='',activePage=1,lastPage=1;
try{currentPin=localStorage.getItem('convo_active_pin')||null;currentUser=JSON.parse(localStorage.getItem('convo_user')||'null')}catch(e){console.warn('Convo storage unavailable; starting fresh',e)}
const $=id=>document.getElementById(id),messagePageMenu=$('messagePageMenu'),authForm=$('authForm'),pinInput=$('pinInput'),nameInput=$('nameInput'),newUserNameBlock=$('newUserNameBlock'),btnLogin=$('btnLogin'),btnLogout=$('btnLogout'),authOverlay=$('authOverlay'),accessCore=$('accessCore'),hudStatus=$('hudStatus'),hudHint=$('hudHint'),progressSegments=[...document.querySelectorAll('.hud-progress span')],btnPagePrev=$('btnPagePrev'),btnPageNext=$('btnPageNext'),messagePageIndicator=$('messagePageIndicator');
const esc=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const formatTime=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
function focusAccess(){pinInput.focus({preventScroll:true})}
async function api(path,options={}){const headers={...(options.headers||{})};if(options.body!==undefined&&!headers['Content-Type'])headers['Content-Type']='application/json';if(currentPin)headers['X-Convo-Pin']=currentPin;const r=await fetch(`${WORKER_URL}${path}`,{...options,headers,cache:'no-store'}),t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}
function showAppError(message){console.error(message);hudStatus.textContent='CONNECTION ERROR';hudHint.textContent='CHECK WORKER ACCESS'}
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
function handleLogout(){stopMessageSync();closeChannelModal();closeSuperAdminPanel();try{localStorage.removeItem('convo_active_pin');localStorage.removeItem('convo_user');sessionStorage.removeItem('convo_active_pin');sessionStorage.removeItem('convo_user')}catch(e){}currentPin=null;currentUser=null;currentChannels=[];activeChannel=null;hiddenPin='';resetSuperAdminArming();autoSubmitting=false;pinInput.value='';pinInput.type='password';pinInput.inputMode='numeric';nameInput.value='';newUserNameBlock.style.display='none';btnLogin.textContent='INITIALIZE';btnLogin.disabled=false;hudStatus.textContent='ACCESS SYSTEM READY';hudHint.textContent='ENTER ACCESS CODE';authOverlay.classList.remove('super-mode','granted','denied','checking');authOverlay.style.display='flex';updateHud();$('messagesFeed')?.replaceChildren();$('channelNavList')?.replaceChildren();$('userDisplayName').textContent='';$('btnDeleteGroup').style.display='none';$('btnCreateChannel').style.display='none';$('superAdminLauncher').hidden=true;requestAnimationFrame(focusAccess)}
function updateHud(){progressSegments.forEach((s,i)=>s.classList.toggle('filled',i<hiddenPin.length));accessCore.style.setProperty('--entry-progress',`${hiddenPin.length*25}%`)}
authForm.addEventListener('submit',e=>{e.preventDefault();login()});
accessCore.addEventListener('click',e=>{e.preventDefault();if(hiddenPin.length===4)authForm.requestSubmit();else focusAccess()});
async function login(){if(hiddenPin.length!==4){hudStatus.textContent='ACCESS CODE REQUIRED';authOverlay.classList.add('denied');autoSubmitting=false;focusAccess();return}const name=nameInput.value.trim(),isSuperAdmin=superAdminMode&&hiddenPin==='4999';try{btnLogin.textContent='VERIFYING';btnLogin.disabled=true;hudStatus.textContent=isSuperAdmin?'ACCESS CORE VERIFYING':'IDENTITY VERIFYING';hudHint.textContent='AUTHENTICATING';authOverlay.classList.remove('denied');authOverlay.classList.add('checking');const r=await fetch(`${WORKER_URL}/auth`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:hiddenPin,name,isSuperAdmin})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Authentication failed');if(d.isNew&&!name&&newUserNameBlock.style.display==='none'){newUserNameBlock.style.display='block';btnLogin.textContent='COMPLETE IDENTITY';btnLogin.disabled=false;hudStatus.textContent='NEW IDENTITY DETECTED';hudHint.textContent='ENTER DISPLAY NAME';authOverlay.classList.remove('checking');autoSubmitting=false;nameInput.focus();return}currentPin=d.assignedPin||hiddenPin;currentUser=d.user;try{localStorage.setItem('convo_active_pin',currentPin);localStorage.setItem('convo_user',JSON.stringify(currentUser))}catch(e){}hudStatus.textContent=d.assignedPin?'IDENTITY CREATED':'ACCESS GRANTED';hudHint.textContent=d.assignedPin?`NEW PIN: ${d.assignedPin}`:(isSuperAdmin?'SUPER ADMIN CORE ONLINE':'IDENTITY VERIFIED');authOverlay.classList.remove('checking','denied');authOverlay.classList.add('granted');setTimeout(()=>{authOverlay.style.display='none';initApp()},d.assignedPin?1800:360)}catch(err){console.error(err);hudStatus.textContent='ACCESS DENIED';hudHint.textContent='TRY AGAIN';authOverlay.classList.remove('checking','granted');authOverlay.classList.add('denied');btnLogin.textContent='INITIALIZE';autoSubmitting=false;hiddenPin='';pinInput.value='';updateHud();alert(err.message||'Failed to connect to authentication server.');focusAccess()}finally{btnLogin.disabled=false}}
async function loadChannels(preferredName=null){const d=await api('/channels');currentChannels=Array.isArray(d.channels)?d.channels:[];renderChannels();const targetName=preferredName||activeChannel?.name||'general',target=currentChannels.find(c=>c.name===targetName)||currentChannels[0];if(target)await selectChannel(target.name,false)}
function renderChannels(){const list=$('channelNavList');list.replaceChildren();currentChannels.forEach(channel=>{const b=document.createElement('button');b.type='button';b.className='channel-item'+(activeChannel?.id===channel.id?' active':'');b.textContent=`# ${channel.name}`;b.title=channel.description||channel.name;b.addEventListener('click',()=>selectChannel(channel.name));list.appendChild(b)})}
function getMessageSignature(messages){return JSON.stringify(messages.map(m=>[m.id,m.channelId,m.pin,m.author,m.role,m.text,m.time||m.createdAt]));}
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
    button.textContent=String(page);
    button.addEventListener('click',async e=>{e.stopPropagation();closePageMenu();await selectMessagePage(page)});
    button.addEventListener('contextmenu',e=>{
      e.preventDefault();
      e.stopPropagation();
      if(lastPage<=1)return;
      closePageMenu();
      deleteMessagePage(page);
    });
    messagePageMenu.appendChild(button);
  }
}
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
async function loadActivePage(preserveScroll=false){
  if(!activeChannel)return;
  const feed=$('messagesFeed');
  stopMessageSync();
  lastMessageSignature='';
  try{
    const d=await api(`/messages?channel=${encodeURIComponent(activeChannel.name)}&page=${encodeURIComponent(activePage)}&sync=1`);
    const messages=Array.isArray(d.messages)?d.messages:[];
    lastMessageSignature=getMessageSignature(messages);
    renderMessages(messages);
    feed.scrollTop=preserveScroll?0:feed.scrollHeight;
  }catch(err){
    feed.innerHTML='<div class="state-message">Unable to load this page.</div>';
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
      const feed=$('messagesFeed');
      const previousScroll=feed.scrollTop;
      const wasAtBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<48;
      lastMessageSignature=signature;
      renderMessages(messages);
      updatePageControls();
      if(preserveScroll){
        if(wasAtBottom)feed.scrollTop=feed.scrollHeight;
        else feed.scrollTop=previousScroll;
      }else feed.scrollTop=feed.scrollHeight;
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
    await api(`/pages?channel=${encodeURIComponent(activeChannel.name)}&page=${encodeURIComponent(target)}`,{method:'DELETE'});
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
  $('activeChannelHeading').textContent=`# ${channel.name}`;
  $('activeChannelDesc').textContent=channel.description||'Project discussion';
  $('btnDeleteGroup').style.display=channel.name==='general'||!['admin','superadmin'].includes(currentUser?.role)?'none':'inline-flex';
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
function renderMessages(messages){const feed=$('messagesFeed');feed.replaceChildren();if(!messages.length){const e=document.createElement('div');e.className='state-message';e.textContent='No messages yet. Start the conversation.';feed.appendChild(e);return}messages.forEach(message=>{const article=document.createElement('article');article.className='message-card';const own=currentUser&&message.pin===currentUser.pin,canDelete=currentUser&&(currentUser.role==='superadmin'||own||(currentUser.role==='admin'&&message.role==='user'));article.innerHTML=`<div class="message-meta"><strong>${esc(message.author||'Unknown')}</strong><span>${esc(message.role||'user')}</span><time>${esc(formatTime(message.time||message.createdAt))}</time></div><div class="message-text">${esc(message.text)}</div>${canDelete?`<button type="button" class="message-delete" data-message-id="${Number(message.id)}">Delete</button>`:''}`;const del=article.querySelector('.message-delete');if(del)del.addEventListener('click',()=>deleteMessage(message.id));feed.appendChild(article)})}
async function deleteMessage(id){if(!confirm('Delete this message?'))return;try{await api(`/messages/${encodeURIComponent(id)}`,{method:'DELETE'});await syncActiveMessages(true)}catch(err){alert(err.message||'Unable to delete message.')}}
const messageContextMenu=document.createElement('div');messageContextMenu.className='message-context-menu';messageContextMenu.hidden=true;messageContextMenu.innerHTML='<button type="button" class="message-context-copy">Copy Message</button>';document.body.appendChild(messageContextMenu);let contextCopyText='';function closeMessageContextMenu(){messageContextMenu.hidden=true;contextCopyText=''}async function copyContextMessage(){const text=contextCopyText;if(!text){closeMessageContextMenu();return}try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy')}catch{}area.remove()}closeMessageContextMenu()}document.addEventListener('contextmenu',event=>{const article=event.target.closest('#messagesFeed .message-card');if(!article)return;const text=article.querySelector('.message-text')?.textContent||'';if(!text)return;event.preventDefault();contextCopyText=text;messageContextMenu.hidden=false;const w=132,h=42,left=Math.min(event.clientX,innerWidth-w-8),top=Math.min(event.clientY,innerHeight-h-8);messageContextMenu.style.left=`${Math.max(8,left)}px`;messageContextMenu.style.top=`${Math.max(8,top)}px`});messageContextMenu.querySelector('.message-context-copy').addEventListener('click',copyContextMessage);document.addEventListener('click',e=>{if(!messageContextMenu.contains(e.target))closeMessageContextMenu()});window.addEventListener('keydown',e=>{if(e.key==='Escape')closeMessageContextMenu()});window.addEventListener('scroll',closeMessageContextMenu,true);window.addEventListener('resize',closeMessageContextMenu);window.handlePostMessage=async function(){if(!currentUser||!activeChannel)return;const input=$('msgInput'),text=input.value.trim();if(!text)return;const button=document.querySelector('.btn-send');input.disabled=true;if(button)button.disabled=true;try{await api('/messages',{method:'POST',body:JSON.stringify({channel:activeChannel.name,page:activePage,text})});input.value='';await syncActiveMessages(true);updatePageControls()}catch(err){alert(err.message||'Unable to post message.')}finally{input.disabled=false;if(button)button.disabled=false;requestAnimationFrame(()=>{input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length)})}};
const channelModal=$('channelModal'),channelForm=$('channelForm'),channelNameInput=$('channelNameInput'),channelDescriptionInput=$('channelDescriptionInput'),channelModalError=$('channelModalError'),btnSubmitChannel=$('btnSubmitChannel');
function closeChannelModal(){channelModal.hidden=true;channelForm.reset();channelModalError.textContent='';btnSubmitChannel.disabled=false;btnSubmitChannel.textContent='Create'}
window.createCustomGroup=function(){if(!currentUser||!['admin','superadmin'].includes(currentUser.role))return;channelModal.hidden=false;channelModalError.textContent='';requestAnimationFrame(()=>channelNameInput.focus())};
channelForm.addEventListener('submit',async e=>{e.preventDefault();if(!currentUser||!['admin','superadmin'].includes(currentUser.role))return;const name=channelNameInput.value.trim(),description=channelDescriptionInput.value.trim()||'Project discussion';if(!name){channelModalError.textContent='Channel name is required.';channelNameInput.focus();return}btnSubmitChannel.disabled=true;btnSubmitChannel.textContent='Creating...';channelModalError.textContent='';try{const d=await api('/channels',{method:'POST',body:JSON.stringify({name,description})});closeChannelModal();await loadChannels(d.channel?.name||name.trim().toLowerCase())}catch(err){channelModalError.textContent=err.message||'Unable to create channel.';btnSubmitChannel.disabled=false;btnSubmitChannel.textContent='Create'}});$('btnCancelChannel').addEventListener('click',closeChannelModal);document.querySelector('[data-close-channel-modal]').addEventListener('click',closeChannelModal);
window.deleteCurrentGroup=async function(){if(!activeChannel||activeChannel.name==='general'||!['admin','superadmin'].includes(currentUser?.role))return;if(!confirm(`Delete #${activeChannel.name} and its messages?`))return;try{await api(`/channels?id=${encodeURIComponent(activeChannel.id)}`,{method:'DELETE'});activeChannel=null;await loadChannels('general')}catch(err){alert(err.message||'Unable to delete channel.')}};
async function loadAdminUsers(){if(currentUser?.role!=='superadmin')return;const rows=$('adminUserRows');rows.innerHTML='<div class="state-message">Loading authority data...</div>';try{const d=await api('/users'),users=Array.isArray(d.users)?d.users:[];rows.replaceChildren();users.forEach(user=>{const row=document.createElement('div');row.className='admin-user-row';row.innerHTML=`<span class="admin-user-main"><strong>${esc(user.name)}</strong><small>PIN ${esc(user.pin)}</small></span><span class="admin-user-role">${esc(user.role)}</span>${user.pin!==currentUser.pin?`<button type="button" class="btn-ctrl" data-pin="${esc(user.pin)}" data-role="${esc(user.role==='admin'?'user':'admin')}">${user.role==='admin'?'Make User':'Make Admin'}</button>`:''}`;const action=row.querySelector('button');if(action)action.addEventListener('click',()=>changeUserRole(action.dataset.pin,action.dataset.role));rows.appendChild(row)})}catch(err){rows.innerHTML='<div class="state-message">Authority data unavailable.</div>';showAppError(err)}}
async function changeUserRole(pin,role){try{await api('/users/role',{method:'PUT',body:JSON.stringify({pin,role})});await loadAdminUsers();await loadAdminAnalytics()}catch(err){alert(err.message||'Unable to change user role.')}}
async function loadAdminAnalytics(){if(currentUser?.role!=='superadmin')return;try{const d=await api('/analytics'),s=d.stats||{};$('superAdminStats').innerHTML=`<div><b>${Number(s.totalUsers||0)}</b><span>Users</span></div><div><b>${Number(s.totalAdmins||0)}</b><span>Admins</span></div><div><b>${Number(s.totalMessages||0)}</b><span>Messages</span></div><div><b>${Number(s.activeUsers||0)}</b><span>Active</span></div>`;$('superAdminActivity').innerHTML=`<div><span>Channels</span><b>${Number(s.totalChannels||0)}</b></div><div><span>Active channels</span><b>${Number(s.activeChannels||0)}</b></div><div><span>Views</span><b>${Number(s.totalViews||0)}</b></div><div><span>Generated</span><b>${esc(formatTime(d.generatedAt))}</b></div>`}catch(err){$('superAdminActivity').textContent='Analytics unavailable.';console.error(err)}}
const superAdminLauncher=$('superAdminLauncher'),superAdminPanel=$('superAdminPanel');
function openSuperAdminPanel(){if(currentUser?.role!=='superadmin')return;superAdminPanel.classList.add('open');superAdminPanel.setAttribute('aria-hidden','false');loadAdminUsers();loadAdminAnalytics()}
function closeSuperAdminPanel(){superAdminPanel.classList.remove('open');superAdminPanel.setAttribute('aria-hidden','true')}
superAdminLauncher.addEventListener('click',()=>superAdminPanel.classList.contains('open')?closeSuperAdminPanel():openSuperAdminPanel());$('superPanelClose').addEventListener('click',closeSuperAdminPanel);$('superPanelRefresh').addEventListener('click',()=>{loadAdminUsers();loadAdminAnalytics()});
async function initApp(){if(!currentUser||appLoading)return;appLoading=true;$('userDisplayName').textContent=currentUser.name||'';$('btnCreateChannel').style.display=['admin','superadmin'].includes(currentUser.role)?'inline-flex':'none';$('superAdminLauncher').hidden=currentUser.role!=='superadmin';closeSuperAdminPanel();try{await loadChannels();if(currentUser.role==='superadmin'){await loadAdminUsers();await loadAdminAnalytics()}}catch(err){$('messagesFeed').innerHTML='<div class="state-message">Unable to connect to Convo.</div>';showAppError(err)}finally{appLoading=false}}
if(currentPin&&currentUser){authOverlay.style.display='none';initApp()}else{authOverlay.style.display='flex';requestAnimationFrame(focusAccess)}