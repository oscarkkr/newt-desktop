import { nicknameFor } from "./nicknames.js";
import { sortNewestFirst } from "./post-order.js";
import { contentSummary, isSafeImageUrl, markdownToHtml, parsePostContent } from "./content.js";
import { contentWarningLabel, normalizeContentWarning } from "./content-warning.js";
import { applyVote, normalizePoll, pollPercent, pollTotal } from "./poll.js";
import { commentWithReply, replyTargetFor } from "./reply.js";

const api=window.__TAURI__?.core?.invoke;
const listen=window.__TAURI__?.event?.listen;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={route:"timeline",page:1,orderMode:0,roomId:"",keywords:"",online:true,posts:[],selected:null,localFavorite:false,openingPid:null,loading:false,settings:null,replyTarget:null};
const quotedPostCache=new Map();
const mockPosts=[
 {pid:284719,text:"今天从图书馆出来，风吹过来的时候突然觉得，夏天真的到了。有人也还留在学校吗？ #284703\n\n![](https://file.tholeapis.top/file.tmpxdoZZH.png)",timestamp:1784705400,likenum:28,n_comments:12,room_id:1,poll:{answers:[{option:"留在学校继续看晚霞",votes:12},{option:"已经回家了",votes:7},{option:"还在实验室",votes:18}],vote:null}},
 {pid:284703,text:"# 毕业前的最后一段路\n\n那些觉得永远不会结束的日常，原来真的会有最后一天。\n\n> 晚风记得我们来过。\n\n- 再走一次学堂路\n- 再看一次晚霞\n\n详情见 [校园地图](https://www.tsinghua.edu.cn/)。",cw:"一点毕业季碎碎念",timestamp:1784701800,likenum:67,n_comments:31,room_id:3,attention:true},
 {pid:284688,text:"求推荐学校附近适合安静看书的咖啡店，最好插座多一点。",timestamp:1784694600,likenum:14,n_comments:21,room_id:2}];
const mockFavoritePids=new Set([284703]);
const mockComments=[{name_id:"洞主",text:"没想到有这么多人还在，谢谢大家。",create_time:1784706000},{name_id:"Alice",text:"我也在，今天的晚霞特别好看。",create_time:1784706300,author_title:"晚风收集者"}];
async function invoke(cmd,args={}){if(api)return api(cmd,args);await new Promise(r=>setTimeout(r,100));if(cmd==="get_settings")return{base_url:"https://api.tholeapis.top",has_token:true};if(cmd==="check_for_update")return{available:false,current_version:"0.7.1",version:null};if(cmd==="install_update")return{ok:true};if(cmd==="get_timeline")return{data:{data:args.page>1?[]:mockPosts},source:args.online?"online":"cache"};if(cmd==="search_posts")return{data:{data:mockPosts.filter(p=>(p.text+(p.cw||"")).includes(args.keywords))},source:"online"};if(cmd==="get_online_attention")return{data:{data:mockPosts.filter(p=>isAttentionEnabled(p))},source:"online"};if(cmd==="get_local_favorites")return{data:{data:mockPosts.filter(p=>mockFavoritePids.has(p.pid))},source:"cache"};if(cmd==="is_local_favorite")return mockFavoritePids.has(args.pid);if(cmd==="set_local_favorite"){if(args.enabled)mockFavoritePids.add(args.pid);else mockFavoritePids.delete(args.pid);return args.enabled}if(cmd==="get_post")return{data:{data:mockPosts.find(p=>p.pid===args.pid)},source:args.online?"online":"cache"};if(cmd==="get_comments")return{data:{data:mockComments},source:args.online?"online":"cache"};if(cmd==="set_attention"){let p=mockPosts.find(p=>p.pid===args.pid);p.attention=args.enabled;if(args.enabled)mockFavoritePids.add(args.pid);return{code:0,attention:args.enabled,likenum:p.likenum}}if(cmd==="create_comment"){mockComments.push({cid:Date.now(),name_id:3,text:args.text,create_time:Math.floor(Date.now()/1000)});return{code:0}}if(cmd==="vote_poll"){let p=mockPosts.find(p=>p.pid===args.pid);p.poll=applyVote(p.poll,args.option);return{code:0,data:p.poll}}return{ok:true,base_url:args.baseUrl||"https://api.tholeapis.top",has_token:true}}
document.addEventListener("DOMContentLoaded",init);
async function init(){applyDisplayPreferences();bind();await bindAuthEvents();skeleton();try{state.settings=await invoke("get_settings");$("#base-url").value=state.settings.base_url;if(!state.settings.has_token)showSettings();await load(true)}catch(e){error(e)}finally{window.setTimeout(()=>checkForUpdate(false),1200)}}
function bind(){
 $$(".nav[data-route]").forEach(b=>b.onclick=()=>route(b.dataset.route));$("#settings").onclick=showSettings;$("#compose").onclick=showCompose;
 $("#refresh").onclick=()=>load(true);$("#more").onclick=()=>load(false);$("#search-form").onsubmit=e=>{e.preventDefault();state.keywords=$("#search-input").value.trim();if(state.keywords)load(true)};
 $("#orders").onclick=e=>{let b=e.target.closest("[data-order]");if(!b)return;state.orderMode=+b.dataset.order;$$("[data-order]").forEach(x=>x.classList.toggle("active",x===b));load(true)};
 $("#room").onchange=()=>{state.roomId=$("#room").value.trim();load(true)};$("#settings-form").onsubmit=saveSettings;$("#compose-form").onsubmit=post;$("#compose-close").onclick=closeCompose;$("#compose-cancel").onclick=closeCompose;$("#comment-form").onsubmit=comment;$("#reply-cancel").onclick=()=>setReplyTarget(null);
 $("#github-login").onclick=githubLogin;$("#clear").onclick=async()=>{if(confirm("确认清除离线缓存？")){await invoke("clear_cache");quotedPostCache.clear();toast("缓存已清除")}};$("#back").onclick=()=>$("#detail-panel").classList.remove("open");
 $("#image-close").onclick=()=>$("#image-dialog").close();$("#image-dialog").onclick=e=>{if(e.target===$("#image-dialog"))$("#image-dialog").close()};
 $("#font-scale").oninput=e=>setFontScale(e.target.value,true);$("#check-update").onclick=()=>checkForUpdate(true);$("#install-update").onclick=installUpdate;bindResizeHandle();
 document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();route("search");$("#search-input").focus()}});
}
async function bindAuthEvents(){if(!listen)return;await listen("github-login-complete",async()=>{try{state.settings=await invoke("get_settings");$("#base-url").value=state.settings.base_url;await invoke("test_connection");if($("#settings-dialog").open)$("#settings-dialog").close();$("#token").value="";toast("GitHub 登录成功，已安全保存");await load(true)}catch(e){error(e)}});await listen("github-login-error",event=>error(event.payload||"GitHub 登录未能保存"))}
function showSettings(){if(state.settings?.base_url)$("#base-url").value=state.settings.base_url;let dialog=$("#settings-dialog");if(!dialog.open){dialog.showModal();$("#settings-title").focus({preventScroll:true})}}
async function githubLogin(){let button=$("#github-login");button.disabled=true;try{await invoke("start_github_login");toast("请在新窗口完成 GitHub 授权")}catch(e){error(e)}finally{button.disabled=false}}
function versionLabel(version){let value=String(version||"—");return value.startsWith("v")?value:`v${value}`}
async function checkForUpdate(manual=false){
 let button=$("#check-update"),statusEl=$("#update-status");if(button.disabled)return;button.disabled=true;if(manual)statusEl.textContent="正在检查更新…";
 try{
  let info=await invoke("check_for_update");
  if(!info.available){statusEl.textContent=`${versionLabel(info.current_version)} 已是最新版`;if(manual)toast("已经是最新版本");return}
  statusEl.textContent=`发现 ${versionLabel(info.version)}`;$("#current-version").textContent=`当前 ${versionLabel(info.current_version)}`;$("#latest-version").textContent=versionLabel(info.version);
  if(manual&&$("#settings-dialog").open)$("#settings-dialog").close();
  if(!$("#settings-dialog").open&&!$("#update-dialog").open){$("#update-dialog").showModal();$("#update-dialog-title").focus({preventScroll:true})}
 }catch(e){statusEl.textContent="暂时无法检查更新";if(manual)error(e)}
 finally{button.disabled=false}
}
async function installUpdate(){
 let button=$("#install-update");button.disabled=true;button.textContent="正在下载并安装…";
 try{await invoke("install_update");button.textContent="正在重启…"}
 catch(e){button.disabled=false;button.textContent="下载并安装";error(e)}
}
function applyDisplayPreferences(){setFontScale(localStorage.getItem("newt-font-scale")||100,false);let mainWidth=$("main").getBoundingClientRect().width,width=Number(localStorage.getItem("newt-feed-width")||470);width=Math.min(Math.max(340,mainWidth-300),Math.max(340,width));document.documentElement.style.setProperty("--feed-width",`${width}px`)}
function showCompose(){let dialog=$("#compose-dialog");dialog.showModal();$("#compose-title").focus({preventScroll:true})}
function setFontScale(value,persist){let scale=Math.min(130,Math.max(90,Number(value)||100));document.documentElement.style.fontSize=`${14*scale/100}px`;$("#font-scale").value=scale;$("#font-scale-value").textContent=`${scale}%`;if(persist)localStorage.setItem("newt-font-scale",String(scale))}
function bindResizeHandle(){let handle=$("#resize-handle"),main=$("main");let resize=x=>{let bounds=main.getBoundingClientRect(),max=Math.max(340,bounds.width-300),width=Math.round(Math.min(max,Math.max(340,x-bounds.left)));document.documentElement.style.setProperty("--feed-width",`${width}px`);handle.setAttribute("aria-valuenow",String(width));return width};handle.onpointerdown=e=>{handle.setPointerCapture(e.pointerId);handle.classList.add("active");document.body.classList.add("resizing")};handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))resize(e.clientX)};handle.onpointerup=e=>{let width=resize(e.clientX);handle.releasePointerCapture(e.pointerId);handle.classList.remove("active");document.body.classList.remove("resizing");localStorage.setItem("newt-feed-width",String(width))};handle.onkeydown=e=>{if(!["ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();let current=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--feed-width"))||470;let width=resize(main.getBoundingClientRect().left+current+(e.key==="ArrowRight"?20:-20));localStorage.setItem("newt-feed-width",String(width))}}
function route(r){state.route=r;state.online=!["favorites","offline"].includes(r);$$(".nav[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===r));$("#search-form").classList.toggle("hidden",r!=="search");$("#orders").classList.toggle("hidden",r!=="timeline");let t={timeline:["NEW T FEED","正在发生"],search:["FULL-TEXT SEARCH","寻找回声"],attention:["ONLINE FOLLOWING","线上关注"],favorites:["LOCAL BOOKMARKS","本地收藏"],offline:["OFFLINE LIBRARY","离线查看"]}[r];$("#eyebrow").textContent=t[0];$("#title").textContent=t[1];if(r==="search"&&!state.keywords){render([]);$("#more").classList.add("hidden");$("#search-input").focus()}else load(true)}
async function load(reset){if(state.loading)return;state.loading=true;if(reset){state.page=1;state.posts=[];skeleton()}let oneShot=["search","attention","favorites"].includes(state.route);if(state.route==="search")notice("正在加载并整理全部搜索结果…");else if(state.route==="attention")notice("正在同步线上关注…");try{let args={roomId:state.roomId,online:state.online},env;if(state.route==="search")env=await invoke("search_posts",{...args,keywords:state.keywords});else if(state.route==="attention")env=await invoke("get_online_attention",{roomId:state.roomId});else if(state.route==="favorites")env=await invoke("get_local_favorites",{roomId:state.roomId});else env=await invoke("get_timeline",{...args,page:state.page,orderMode:state.orderMode});let posts=list(env.data),combined=reset?posts:[...state.posts,...posts];state.posts=["search","attention"].includes(state.route)?sortNewestFirst(posts):combined;render(state.posts);$("#more").classList.toggle("hidden",oneShot||!posts.length);if(posts.length&&!oneShot)state.page++;notice(env.warning);status(env.source==="online")}catch(e){render(state.posts);$("#more").classList.add("hidden");error(e);status(false)}finally{state.loading=false}}
function list(v){let d=v?.data??v;return Array.isArray(d)?d:[]}
function skeleton(){$("#posts").innerHTML='<div class="post skeleton"></div>'.repeat(5);$("#empty").classList.add("hidden")}
function render(posts){
 $("#posts").innerHTML="";$("#empty").classList.toggle("hidden",posts.length>0);
 posts.forEach(p=>{
  let el=document.createElement("article");
  el.className="post"+(state.selected?.pid===p.pid?" selected":"");
  el.innerHTML=`<div class="meta"><b class="id">#${esc(p.pid)}</b><time>${time(p.timestamp||p.create_time)}</time></div><div class="cw-gate compact"></div><div class="guarded-content"><div class="post-rich"></div><div class="poll-container compact-poll"></div><div class="quote-list compact"></div></div><div class="stats"><span>♡ ${num(p.likenum||p.n_attentions)}</span><span>ↄ ${num(p.n_comments||p.reply)}</span>${p.room_id!==undefined?`<span class="room">分区 ${esc(p.room_id)}</span>`:""}</div>`;
  renderContentWarning(el.querySelector(".cw-gate"),el.querySelector(".guarded-content"),p.cw,`post-${p.pid}-summary`,()=>{
   let parsed=renderRichContent(el.querySelector(".post-rich"),p.text,"compact");
   renderPoll(el.querySelector(".poll-container"),p,true);
   renderQuotePreviews(el.querySelector(".quote-list"),parsed.quotePids,p.pid)
  });
  el.onclick=()=>openPost(p.pid);$("#posts").append(el)
 })
}
function resetDetailScroll(){let panel=$("#detail-panel");panel.scrollTop=0}
async function openPost(pid){
 state.openingPid=pid;resetDetailScroll();setReplyTarget(null);$("#detail-panel").classList.add("open");$("#placeholder").classList.add("hidden");$("#detail").classList.remove("hidden");$("#post-body").innerHTML='<div class="body skeleton"></div>';
 try{
  let [pe,ce,isFavorite]=await Promise.all([invoke("get_post",{pid,online:state.online}),invoke("get_comments",{pid,online:state.online}),invoke("is_local_favorite",{pid})]);
  if(state.openingPid!==pid)return;
  let p=pe.data?.data??pe.data;state.selected=p;state.localFavorite=!!isFavorite;quotedPostCache.set(`${state.online}:${p.pid}`,Promise.resolve(p));
  $("#pid").textContent="#"+p.pid;$("#attention").textContent=isAttentionEnabled(p)?"★ 已关注":"☆ 关注";$("#attention").onclick=()=>attention(p);
  $("#favorite").textContent=state.localFavorite?"◆ 已收藏":"◆ 收藏";$("#favorite").onclick=()=>favorite(p);
  $("#post-body").innerHTML=`<div class="body"><div class="cw-gate"></div><div class="guarded-content"><div class="body-rich rich-content"></div><div class="poll-container"></div><div class="quote-list"></div></div><div class="meta"><time>${time(p.timestamp||p.create_time)}</time><span>♡ ${num(p.likenum||p.n_attentions)}　ↄ ${num(p.n_comments||p.reply)}</span></div></div>`;
  renderContentWarning($("#post-body .cw-gate"),$("#post-body .guarded-content"),p.cw,`post-${p.pid}-detail`,()=>{
   let parsed=renderRichContent($("#post-body .body-rich"),p.text,"detail");renderPoll($("#post-body .poll-container"),p,false);renderQuotePreviews($("#post-body .quote-list"),parsed.quotePids,p.pid)
  });
  renderComments(list(ce.data));render(state.posts);resetDetailScroll()
 }catch(e){if(state.openingPid===pid)error(e)}
}
function renderContentWarning(gate,content,value,contentId,renderContent){
 let warning=normalizeContentWarning(value),rendered=false;
 content.id=contentId;gate.replaceChildren();
 let ensureRendered=()=>{if(!rendered){renderContent();rendered=true}};
 if(!warning){gate.classList.add("hidden");content.classList.remove("hidden");content.removeAttribute("aria-hidden");ensureRendered();return}
 gate.classList.remove("hidden");content.classList.add("hidden");content.setAttribute("aria-hidden","true");
 let button=document.createElement("button"),copy=document.createElement("span"),title=document.createElement("b"),hint=document.createElement("small"),action=document.createElement("strong");
 button.type="button";button.className="cw-toggle";button.setAttribute("aria-controls",contentId);button.setAttribute("aria-expanded","false");
 title.textContent=contentWarningLabel(warning);hint.textContent="正文已默认隐藏";action.textContent="显示内容";copy.append(title,hint);button.append(copy,action);gate.append(button);
 button.onclick=e=>{e.stopPropagation();let show=content.classList.contains("hidden");if(show)ensureRendered();content.classList.toggle("hidden",!show);content.setAttribute("aria-hidden",String(!show));button.setAttribute("aria-expanded",String(show));action.textContent=show?"隐藏内容":"显示内容";hint.textContent=show?"内容已显示":"正文已默认隐藏";gate.classList.toggle("expanded",show)}
}
function renderComments(cs){
 $("#comment-count").textContent=cs.length;$("#comments").innerHTML="";
 cs.forEach((c,i)=>{
  let parsed=parsePostContent(c.text),target=replyTargetFor(c,i+1),el=document.createElement("article");el.className="comment";el.dataset.commentKey=target.key;
  el.innerHTML=`<span class="floor">${i+1}F</span><div class="comment-meta"><b>${esc(target.nickname)}</b>${c.author_title?` · ${esc(c.author_title)}`:""}<time>${time(c.create_time||c.timestamp)}</time><button type="button" class="comment-reply" aria-label="回复 ${esc(target.nickname)}">↩ 回复</button></div><div class="comment-rich rich-content"></div><div class="quote-list comment-quotes"></div>`;
  el.querySelector(".comment-reply").onclick=()=>setReplyTarget(state.replyTarget?.key===target.key?null:target);
  renderRichContent(el.querySelector(".comment-rich"),c.text,"comment");renderQuotePreviews(el.querySelector(".quote-list"),parsed.quotePids,state.selected?.pid);$("#comments").append(el)
 })
 syncReplyTarget()
}
function setReplyTarget(target){
 state.replyTarget=target;syncReplyTarget();
 if(target){let input=$("#comment-input");input.focus();input.setSelectionRange(input.value.length,input.value.length)}
}
function syncReplyTarget(){
 let context=$("#reply-context"),input=$("#comment-input"),target=state.replyTarget;
 context.classList.toggle("hidden",!target);$("#reply-target").textContent=target?`${target.floor}F ${target.nickname}`:"";input.placeholder=target?`回复 ${target.nickname}…`:"友善地留下你的回应…";
 $$(".comment[data-comment-key]").forEach(comment=>comment.classList.toggle("reply-selected",!!target&&comment.dataset.commentKey===target.key))
}
function renderRichContent(container,text,variant){
 let parsed=parsePostContent(text);
 container.onclick=e=>{if(e.target.closest("a"))e.stopPropagation()};
 if(variant==="compact"){
  let paragraph=document.createElement("p");paragraph.className="excerpt";paragraph.textContent=contentSummary(text);container.append(paragraph);
  if(parsed.images[0])container.append(createImageFigure(parsed.images[0],true));
  return parsed
 }
 if(!parsed.segments.length){let paragraph=document.createElement("p");paragraph.className="markdown-empty";paragraph.textContent="（内容为空）";container.append(paragraph)}
 parsed.segments.forEach(segment=>{
  if(segment.type==="image"){container.append(createImageFigure(segment,false));return}
  let value=segment.text.replace(/^\n+|\n+$/g,"");if(!value)return;
  let markdown=document.createElement("div");markdown.className=`markdown-content markdown-${variant}`;markdown.innerHTML=markdownToHtml(value);container.append(markdown)
 });
 return parsed
}
function renderPoll(container,post,compact){
 let poll=normalizePoll(post.poll);container.innerHTML="";container.dataset.pollPid=String(post.pid);container.dataset.compact=compact?"true":"false";
 if(!poll.answers.length){container.classList.add("hidden");return}
 container.classList.remove("hidden");let total=pollTotal(poll),saved=localStorage.getItem(`newt-poll-vote:${post.pid}`),candidate=poll.vote||saved,voted=poll.answers.some(answer=>answer.option===candidate)?candidate:null;
 let section=document.createElement("section");section.className="poll-card"+(compact?" compact":"");section.onclick=e=>e.stopPropagation();
 let header=document.createElement("div");header.className="poll-head";header.innerHTML=`<b>投票</b><span>${voted?"投票结果":"选择一个选项"} · 共 ${num(total)} 票</span>`;section.append(header);
 if(voted){
  let results=document.createElement("div");results.className="poll-results";
  poll.answers.forEach(answer=>{
   let percent=pollPercent(answer.votes,total),row=document.createElement("div");row.className="poll-result"+(answer.option===voted?" selected":"");
   row.innerHTML=`<div class="poll-result-track"><span class="poll-result-fill"></span><span class="poll-option-text"></span><b>${percent}%</b></div><small>${num(answer.votes)} 票${answer.option===voted?" · 你的选择":""}</small>`;
   row.querySelector(".poll-result-fill").style.width=`${percent}%`;row.querySelector(".poll-option-text").textContent=answer.option;results.append(row)
  });section.append(results)
 }else{
  let form=document.createElement("form");form.className="poll-form";form.onclick=e=>e.stopPropagation();
  poll.answers.forEach((answer,index)=>{
   let label=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");label.className="poll-option";input.type="radio";input.name=`poll-${post.pid}`;input.value=answer.option;input.id=`poll-${post.pid}-${index}`;text.textContent=answer.option;label.append(input,text);form.append(label)
  });
  let footer=document.createElement("div"),hint=document.createElement("small"),button=document.createElement("button");footer.className="poll-actions";hint.textContent=state.online?"投票后不可修改":"离线模式下不能投票";button.type="submit";button.className="primary";button.textContent="确认投票";button.disabled=true;footer.append(hint,button);form.append(footer);
  form.onchange=()=>{button.disabled=!state.online||!form.querySelector('input[type="radio"]:checked')};
  form.onsubmit=e=>{e.preventDefault();let selected=form.querySelector('input[type="radio"]:checked');if(selected)submitPollVote(post,selected.value,button)};
  section.append(form)
 }
 container.append(section)
}
async function submitPollVote(post,option,button){
 button.disabled=true;button.textContent="正在投票…";
 try{
  let response=await invoke("vote_poll",{pid:post.pid,option}),updated=response?.data;
  if(!updated?.answers)throw new Error("服务器没有返回投票结果");
  post.poll={...updated,vote:updated.vote||option};localStorage.setItem(`newt-poll-vote:${post.pid}`,option);
  state.posts.filter(item=>Number(item.pid)===Number(post.pid)).forEach(item=>item.poll=post.poll);
  if(Number(state.selected?.pid)===Number(post.pid))state.selected.poll=post.poll;
  document.querySelectorAll(`[data-poll-pid="${post.pid}"]`).forEach(element=>renderPoll(element,post,element.dataset.compact==="true"));toast("投票成功")
 }catch(e){button.disabled=false;button.textContent="确认投票";error(e)}
}
function createImageFigure(image,compact){
 let figure=document.createElement("figure"),button=document.createElement("button"),img=document.createElement("img"),fallback=document.createElement("figcaption");
 figure.className="post-image"+(compact?" compact":"");button.type="button";button.className="image-open";button.setAttribute("aria-label",image.alt?`查看图片：${image.alt}`:"查看帖子图片");
 fallback.textContent="图片加载失败";fallback.className="image-fallback";
 if(isSafeImageUrl(image.url)){
  img.src=image.url;img.alt=image.alt||"帖子图片";img.loading="lazy";img.decoding="async";img.referrerPolicy="no-referrer";
  img.onerror=()=>{figure.classList.add("broken");button.disabled=true};
  button.onclick=e=>{e.stopPropagation();openImage(image.url,image.alt)}
 }else{figure.classList.add("broken");button.disabled=true}
 button.append(img);figure.append(button,fallback);return figure
}
function openImage(url,alt){let dialog=$("#image-dialog"),img=$("#image-preview");img.src=url;img.alt=alt||"帖子图片";$("#image-caption").textContent=alt||"帖子图片";if(!dialog.open)dialog.showModal()}
function getQuotedPost(pid){
 let inMemory=state.posts.find(post=>Number(post.pid)===Number(pid));if(inMemory)return Promise.resolve(inMemory);
 let key=`${state.online}:${pid}`;if(quotedPostCache.has(key))return quotedPostCache.get(key);
 let pending=invoke("get_post",{pid,online:state.online}).then(env=>{let post=env.data?.data??env.data;if(!post?.pid)throw new Error("引用帖不存在");return post}).catch(error=>{quotedPostCache.delete(key);throw error});
 quotedPostCache.set(key,pending);return pending
}
function renderQuotePreviews(container,pids,ownerPid){
 let unique=[...new Set(pids)].filter(pid=>Number(pid)!==Number(ownerPid));container.innerHTML="";container.classList.toggle("hidden",!unique.length);
 unique.forEach(pid=>{
  let slot=document.createElement("div");slot.className="quote-slot loading";slot.textContent=`正在读取引用 #${pid}…`;container.append(slot);
  getQuotedPost(pid).then(post=>{
   if(!slot.isConnected)return;let button=document.createElement("button");button.type="button";button.className="quoted-post";
   button.innerHTML=`<span class="quoted-head"><b>↳ 引用 #${esc(post.pid)}</b><time>${time(post.timestamp||post.create_time)}</time></span><span class="quoted-text"></span><span class="quoted-stats">♡ ${num(post.likenum||post.n_attentions)}　ↄ ${num(post.n_comments||post.reply)}</span>`;
   let warning=contentWarningLabel(post.cw);button.querySelector(".quoted-text").textContent=warning?`${warning} · 内容已隐藏`:contentSummary(post.text,160);button.classList.toggle("content-warning-quote",!!warning);button.onclick=e=>{e.stopPropagation();openPost(post.pid)};slot.classList.remove("loading");slot.replaceChildren(button)
  }).catch(()=>{if(slot.isConnected){slot.classList.remove("loading");slot.classList.add("unavailable");slot.textContent=`引用 #${pid} 暂时无法读取`}})
 })
}
async function saveSettings(e){e.preventDefault();try{state.settings=await invoke("save_settings",{baseUrl:$("#base-url").value.trim(),token:$("#token").value.trim()||null});await invoke("test_connection");$("#settings-dialog").close();$("#token").value="";toast("设置已安全保存");load(true)}catch(x){error(x)}}
function closeCompose(){$("#compose-dialog").close()}
async function post(e){e.preventDefault();try{await invoke("create_post",{input:{cw:$("#cw").value.trim(),text:$("#text").value.trim(),room_id:$("#post-room").value.trim(),allow_search:$("#allow-search").checked,use_title:$("#use-title").checked}});$("#compose-dialog").close();$("#compose-form").reset();toast("已经放进树洞");route("timeline")}catch(x){error(x)}}
async function comment(e){e.preventDefault();let body=$("#comment-input").value.trim(),text=commentWithReply(body,state.replyTarget);if(!text||!state.selected)return;try{await invoke("create_comment",{pid:state.selected.pid,text,useTitle:$("#comment-title").checked});$("#comment-input").value="";setReplyTarget(null);toast("回应已发送");let c=await invoke("get_comments",{pid:state.selected.pid,online:true});renderComments(list(c.data))}catch(x){error(x)}}
function isAttentionEnabled(post){return post?.attention===true||post?.attention===1||post?.attention==="1"}
async function attention(p){let button=$("#attention"),enabled=!isAttentionEnabled(p);button.disabled=true;try{let response=await invoke("set_attention",{pid:p.pid,enabled});p.attention=enabled;if(response?.likenum!==undefined)p.likenum=response.likenum;state.posts.filter(item=>Number(item.pid)===Number(p.pid)).forEach(item=>{item.attention=enabled;if(response?.likenum!==undefined)item.likenum=response.likenum});button.textContent=enabled?"★ 已关注":"☆ 关注";if(enabled){state.localFavorite=true;$("#favorite").textContent="◆ 已收藏"}render(state.posts);toast(enabled?"已加入线上关注，并保存到本地收藏":"已取消线上关注，本地收藏仍保留");if(!enabled&&state.route==="attention"){state.posts=state.posts.filter(item=>Number(item.pid)!==Number(p.pid));render(state.posts)}}catch(x){error(x)}finally{button.disabled=false}}
async function favorite(p){let button=$("#favorite"),enabled=!state.localFavorite;button.disabled=true;try{await invoke("set_local_favorite",{pid:p.pid,enabled});state.localFavorite=enabled;button.textContent=enabled?"◆ 已收藏":"◆ 收藏";toast(enabled?"已加入本地收藏":"已取消本地收藏");if(!enabled&&state.route==="favorites"){state.posts=state.posts.filter(item=>Number(item.pid)!==Number(p.pid));render(state.posts)}}catch(x){error(x)}finally{button.disabled=false}}
function status(ok){$("#dot").className=ok?"online":"offline";$("#status").textContent=ok?"已连接":"离线模式";$("#status-detail").textContent=ok?(state.settings?.base_url||"新T服务器"):"正在读取本地缓存"}
function notice(m){$("#notice").classList.toggle("hidden",!m);$("#notice").textContent=m?"提示："+m:""}function error(e){let message=typeof e==="string"?e:e?.message||String(e);toast(message,true);if(message.includes("登录状态已失效")||message.includes("尚未设置登录 Token"))showSettings()}function toast(t,bad=false){let e=document.createElement("div");e.className="toast"+(bad?" error":"");e.textContent=t;$("#toasts").append(e);setTimeout(()=>e.remove(),3500)}
function time(ts){if(!ts)return"时间未知";return new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(+ts*1000))}function num(n){return +n>=1000?(+n/1000).toFixed(1)+"k":String(n||0)}function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
