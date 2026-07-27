use keyring::Entry;
use reqwest::{header, StatusCode};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::{Update, UpdaterExt};
use thiserror::Error;
use url::Url;

const DEFAULT_BASE: &str = "https://api.tholeapis.top";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const MAX_SEARCH_PAGES: u32 = 100;
const KEYRING_SERVICE: &str = "app.newt.desktop";
const KEYRING_USER: &str = "user-token";
const GITHUB_LOGIN_WINDOW: &str = "github-login";
const LOGIN_CALLBACK_HOST: &str = "new-t.github.io";

#[derive(Debug, Error)]
enum Error {
    #[error("尚未设置登录 Token")] MissingToken,
    #[error("服务器地址无效：{0}")] InvalidUrl(String),
    #[error("登录状态已失效或 Token 不正确")] Unauthorized,
    #[error("服务器拒绝请求，请稍后重试")] Forbidden,
    #[error("服务器未接受请求参数")] Unprocessable,
    #[error("服务器返回了无法识别的内容")] InvalidResponse,
    #[error("网络请求失败：{0}")] Network(String),
    #[error("本地数据读写失败：{0}")] Storage(String),
    #[error("应用更新失败：{0}")] Update(String),
    #[error("{0}")] Other(String),
}
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
impl From<rusqlite::Error> for Error { fn from(e: rusqlite::Error) -> Self { Self::Storage(e.to_string()) } }
impl From<std::io::Error> for Error { fn from(e: std::io::Error) -> Self { Self::Storage(e.to_string()) } }
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize, Deserialize)]
struct Settings { base_url: String }
impl Default for Settings { fn default() -> Self { Self { base_url: DEFAULT_BASE.into() } } }
#[derive(Serialize)]
struct SettingsSummary { base_url: String, has_token: bool }
#[derive(Serialize)]
struct Envelope { data: Value, source: &'static str, warning: Option<String> }
struct PendingUpdate(Mutex<Option<Update>>);
#[derive(Serialize)]
struct UpdateInfo {
    available: bool,
    current_version: String,
    version: Option<String>,
}

struct State { dir: PathBuf, settings: Mutex<Settings>, db: Mutex<Connection> }
impl State {
    fn token(&self) -> Result<String> {
        Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| Error::Storage(e.to_string()))?
            .get_password().map_err(|_| Error::MissingToken)
    }
    fn summary(&self) -> SettingsSummary {
        let base_url = self.settings.lock().map(|s| s.base_url.clone()).unwrap_or_else(|_| DEFAULT_BASE.into());
        SettingsSummary { base_url, has_token: self.token().is_ok() }
    }
}

fn store_token(token: &str) -> Result<()> {
    let token = clean_token(token).ok_or_else(|| Error::Other("登录回调没有提供有效 Token".into()))?;
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| Error::Storage(e.to_string()))?
        .set_password(&token)
        .map_err(|e| Error::Storage(e.to_string()))
}

fn clean_token(raw: &str) -> Option<String> {
    let token = raw.trim().trim_matches(['\'', '"']);
    if token.is_empty() || token.len() > 4096 || token.chars().any(char::is_control) {
        None
    } else {
        Some(token.to_owned())
    }
}

fn login_callback_token(url: &Url) -> Option<String> {
    if url.scheme() != "https" || url.host_str() != Some(LOGIN_CALLBACK_HOST) {
        return None;
    }
    let query_token = url
        .query_pairs()
        .find_map(|(key, value)| (key == "token").then(|| value.into_owned()));
    let fragment_token = url
        .fragment()
        .and_then(|fragment| fragment.strip_prefix("##token="))
        .map(str::to_owned);
    query_token.or(fragment_token).and_then(|token| clean_token(&token))
}

fn is_auth_error(error: &Error) -> bool {
    matches!(error, Error::MissingToken | Error::Unauthorized)
}

fn normalize_base(input: &str) -> Result<String> {
    let mut url = Url::parse(input.trim()).map_err(|_| Error::InvalidUrl(input.into()))?;
    if url.scheme() != "https" && !(url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))) {
        return Err(Error::InvalidUrl("仅支持 HTTPS；本地调试可使用 localhost".into()));
    }
    url.set_query(None); url.set_fragment(None);
    let p = url.path().trim_end_matches('/').trim_end_matches("/_api/v1").trim_end_matches("/_api/v2").to_string();
    url.set_path(&p);
    Ok(url.as_str().trim_end_matches('/').into())
}

fn init_db(path: PathBuf) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS posts(pid INTEGER PRIMARY KEY,json TEXT NOT NULL,text_search TEXT NOT NULL,timestamp INTEGER NOT NULL DEFAULT 0,room_id TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS comments(pid INTEGER NOT NULL,cid INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(pid,cid));
      CREATE TABLE IF NOT EXISTS favorites(pid INTEGER PRIMARY KEY,saved_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS posts_time ON posts(timestamp DESC);
      CREATE INDEX IF NOT EXISTS favorites_time ON favorites(saved_at DESC);")?;
    Ok(db)
}
fn cache_posts(db: &mut Connection, posts: &[Value]) -> Result<()> {
    let tx = db.transaction()?;
    for p in posts {
        if let Some(pid) = p.get("pid").and_then(Value::as_i64) {
            let text = format!("{}\n{}", p["cw"].as_str().unwrap_or(""), p["text"].as_str().unwrap_or("")).to_lowercase();
            let ts = p.get("timestamp").or_else(|| p.get("create_time")).and_then(Value::as_i64).unwrap_or(0);
            let room = p.get("room_id").map(|v| v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string())).unwrap_or_default();
            tx.execute("INSERT INTO posts VALUES(?1,?2,?3,?4,?5) ON CONFLICT(pid) DO UPDATE SET json=?2,text_search=?3,timestamp=?4,room_id=?5",
              params![pid,p.to_string(),text,ts,room])?;
        }
    }
    tx.commit()?; Ok(())
}
fn cached_posts(db: &Connection, page: u32, room: &str, search: Option<&str>) -> Result<Vec<Value>> {
    let needle = format!("%{}%", search.unwrap_or("").split_whitespace().next().unwrap_or("").trim_matches(['+','-','\'','"']).to_lowercase());
    let mut st = db.prepare("SELECT json FROM posts WHERE text_search LIKE ?1 AND (?2='' OR room_id=?2) ORDER BY timestamp DESC LIMIT 25 OFFSET ?3")?;
    let rows = st.query_map(params![needle,room,page.saturating_sub(1)*25], |r| r.get::<_,String>(0))?;
    rows.map(|r| serde_json::from_str(&r?).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e))))
        .collect::<std::result::Result<Vec<_>,_>>().map_err(Into::into)
}
fn cached_search_all(db: &Connection, room: &str, search: &str) -> Result<Vec<Value>> {
    let needle = format!("%{}%", search.split_whitespace().next().unwrap_or("").trim_matches(['+','-','\'','"']).to_lowercase());
    let mut st = db.prepare("SELECT json FROM posts WHERE text_search LIKE ?1 AND (?2='' OR room_id=?2) ORDER BY timestamp DESC")?;
    let rows = st.query_map(params![needle,room], |r| r.get::<_,String>(0))?;
    rows.map(|r| serde_json::from_str(&r?).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e))))
        .collect::<std::result::Result<Vec<_>,_>>().map_err(Into::into)
}
fn cached_post(db: &Connection, pid: i64) -> Result<Option<Value>> {
    let mut st = db.prepare("SELECT json FROM posts WHERE pid=?1")?;
    let mut rows=st.query(params![pid])?;
    Ok(rows.next()?.and_then(|r| r.get::<_,String>(0).ok()).and_then(|s| serde_json::from_str(&s).ok()))
}
fn cached_favorites(db: &Connection, room: &str) -> Result<Vec<Value>> {
    let mut st = db.prepare(
        "SELECT posts.json FROM favorites
         JOIN posts ON posts.pid=favorites.pid
         WHERE (?1='' OR posts.room_id=?1)
         ORDER BY favorites.saved_at DESC, favorites.pid DESC"
    )?;
    let rows=st.query_map(params![room],|r|r.get::<_,String>(0))?;
    rows.map(|r|serde_json::from_str(&r?).map_err(|e|rusqlite::Error::ToSqlConversionFailure(Box::new(e))))
        .collect::<std::result::Result<Vec<_>,_>>().map_err(Into::into)
}
fn cached_comments(db: &Connection, pid: i64) -> Result<Vec<Value>> {
    let mut st=db.prepare("SELECT json FROM comments WHERE pid=?1 ORDER BY cid")?;
    let rows=st.query_map(params![pid],|r|r.get::<_,String>(0))?;
    Ok(rows.filter_map(|r|r.ok().and_then(|s|serde_json::from_str(&s).ok())).collect())
}
fn save_posts(state: &State, posts: &[Value]) -> Result<()> {
    let mut db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cache_posts(&mut db,posts)
}
fn read_posts(state: &State, page:u32, room:&str, search:Option<&str>) -> Result<Vec<Value>> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cached_posts(&db,page,room,search)
}
fn read_search_all(state: &State, room:&str, search:&str) -> Result<Vec<Value>> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cached_search_all(&db,room,search)
}
fn read_post(state: &State, pid:i64) -> Result<Option<Value>> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cached_post(&db,pid)
}
fn read_favorites(state:&State,room:&str)->Result<Vec<Value>> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cached_favorites(&db,room)
}
fn favorite_exists(db:&Connection,pid:i64)->Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM favorites WHERE pid=?1)",
        params![pid],
        |row|row.get::<_,bool>(0)
    )?)
}
fn set_favorite_in_db(db:&Connection,pid:i64,enabled:bool)->Result<()> {
    if enabled {
        db.execute(
            "INSERT OR IGNORE INTO favorites(pid,saved_at)
             VALUES(?1,CAST(strftime('%s','now') AS INTEGER))",
            params![pid]
        )?;
    } else {
        db.execute("DELETE FROM favorites WHERE pid=?1",params![pid])?;
    }
    Ok(())
}
fn read_comments(state: &State, pid:i64) -> Result<Vec<Value>> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    cached_comments(&db,pid)
}
fn update_cached_poll(state:&State,pid:i64,poll:&Value)->Result<()> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    if let Some(mut post)=cached_post(&db,pid)? {
        post["poll"]=poll.clone();
        db.execute("UPDATE posts SET json=?1 WHERE pid=?2",params![post.to_string(),pid])?;
    }
    Ok(())
}
fn save_online_attention_state(state:&State,pid:i64,enabled:bool,response:&Value)->Result<()> {
    let mut db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    let tx=db.transaction()?;
    if let Some(mut post)=cached_post(&tx,pid)? {
        post["attention"]=Value::Bool(enabled);
        if let Some(count)=response.get("likenum").or_else(||response.get("n_attentions")) {
            post["likenum"]=count.clone();
        }
        tx.execute("UPDATE posts SET json=?1 WHERE pid=?2",params![post.to_string(),pid])?;
    }
    tx.commit()?;
    Ok(())
}
fn set_favorite_state(state:&State,pid:i64,enabled:bool)->Result<()> {
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    set_favorite_in_db(&db,pid,enabled)
}
fn response_error(value:&Value,fallback:&str)->Option<Error> {
    value.get("code").and_then(Value::as_i64).filter(|code|*code!=0).map(|_|{
        Error::Other(value.get("msg").and_then(Value::as_str).unwrap_or(fallback).into())
    })
}
fn sanitize_json(s: &str) -> String {
    let mut out=String::with_capacity(s.len()); let mut inside=false; let mut escaped=false;
    for c in s.chars() {
        if inside && !escaped && (c as u32)<32 { use std::fmt::Write; let _=write!(out,"\\u{:04x}",c as u32); continue; }
        if c=='"' && !escaped { inside=!inside; }
        escaped=inside && c=='\\' && !escaped;
        if c!='\\' { escaped=false; }
        out.push(c);
    } out
}
fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder().user_agent(UA).timeout(Duration::from_secs(25)).build().map_err(|e|Error::Network(e.to_string()))
}
async fn request_with_client(client:&reqwest::Client, state:&State, version:u8, endpoint:&str, query:&[(&str,String)], form:Option<&[(String,String)]>) -> Result<Value> {
    let base=state.settings.lock().map_err(|_|Error::Storage("设置不可用".into()))?.base_url.clone();
    let url=format!("{base}/_api/v{version}/{}",endpoint.trim_start_matches('/'));
    let req=if let Some(form)=form { client.post(url).header("User-Token",state.token()?).header(header::CONTENT_TYPE,"application/x-www-form-urlencoded").form(form) }
      else { client.get(url).header("User-Token",state.token()?).query(query) };
    let res=req.send().await.map_err(|e|Error::Network(e.to_string()))?; let status=res.status(); let text=res.text().await.map_err(|e|Error::Network(e.to_string()))?;
    match status { StatusCode::UNAUTHORIZED=>Err(Error::Unauthorized),StatusCode::FORBIDDEN=>Err(Error::Forbidden),StatusCode::UNPROCESSABLE_ENTITY=>Err(Error::Unprocessable),
      s if !s.is_success()=>Err(Error::Network(format!("服务器返回 {s}"))), _=>serde_json::from_str(&sanitize_json(&text)).map_err(|_|Error::InvalidResponse)}
}
async fn request(state:&State, version:u8, endpoint:&str, query:&[(&str,String)], form:Option<&[(String,String)]>) -> Result<Value> {
    request_with_client(&http_client()?,state,version,endpoint,query,form).await
}
fn list(v:&Value)->&[Value] { v.get("data").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) }

#[tauri::command] fn get_settings(state:tauri::State<'_,State>)->SettingsSummary { state.summary() }
#[tauri::command] fn save_settings(state:tauri::State<'_,State>,base_url:String,token:Option<String>)->Result<SettingsSummary>{
    let base_url=normalize_base(&base_url)?; let settings=Settings{base_url};
    std::fs::write(state.dir.join("settings.json"),serde_json::to_string_pretty(&settings).map_err(|e|Error::Storage(e.to_string()))?)?;
    *state.settings.lock().map_err(|_|Error::Storage("设置不可用".into()))?=settings;
    if let Some(t)=token { if !t.trim().is_empty(){ store_token(&t)?; } }
    Ok(state.summary())
}
#[tauri::command] async fn start_github_login(app:tauri::AppHandle,state:tauri::State<'_,State>)->Result<()>{
    if let Some(window)=app.get_webview_window(GITHUB_LOGIN_WINDOW){
        window.show().map_err(|e|Error::Other(e.to_string()))?;
        window.set_focus().map_err(|e|Error::Other(e.to_string()))?;
        return Ok(())
    }
    let base=state.settings.lock().map_err(|_|Error::Storage("设置不可用".into()))?.base_url.clone();
    let login_url=Url::parse(&format!("{base}/_login/gh")).map_err(|_|Error::InvalidUrl(base))?;
    let app_for_navigation=app.clone();
    let completed=Arc::new(AtomicBool::new(false));
    let completed_for_navigation=completed.clone();
    WebviewWindowBuilder::new(&app,GITHUB_LOGIN_WINDOW,WebviewUrl::External(login_url))
        .title("使用 GitHub 登录 · 新T树洞")
        .inner_size(560.0,760.0)
        .min_inner_size(420.0,560.0)
        .center()
        .on_navigation(move |url|{
            let Some(token)=login_callback_token(url) else{return true};
            if completed_for_navigation.swap(true,Ordering::SeqCst){return false}
            let result=store_token(&token);
            match result{
                Ok(())=>{let _=app_for_navigation.emit_to("main","github-login-complete",());}
                Err(error)=>{let _=app_for_navigation.emit_to("main","github-login-error",error.to_string());}
            }
            let app_for_close=app_for_navigation.clone();
            tauri::async_runtime::spawn(async move{
                if let Some(window)=app_for_close.get_webview_window(GITHUB_LOGIN_WINDOW){let _=window.close();}
            });
            false
        })
        .build()
        .map_err(|e|Error::Other(format!("无法打开 GitHub 登录窗口：{e}")))?;
    Ok(())
}
#[tauri::command] async fn test_connection(state:tauri::State<'_,State>)->Result<Value>{
    request(&state,1,"getlist",&[("p","1".into()),("order_mode","0".into()),("room_id","".into())],None).await?;
    Ok(json!({"ok":true}))
}
#[tauri::command] async fn get_timeline(state:tauri::State<'_,State>,page:u32,order_mode:u8,room_id:String,online:bool)->Result<Envelope>{
    if online { match request(&state,1,"getlist",&[("p",page.max(1).to_string()),("order_mode",order_mode.to_string()),("room_id",room_id.clone())],None).await {
      Ok(v)=>{save_posts(&state,list(&v))?;return Ok(Envelope{data:v,source:"online",warning:None})},
      Err(e)=>{if is_auth_error(&e){return Err(e)}let c=read_posts(&state,page,&room_id,None)?;if c.is_empty(){return Err(e)}return Ok(Envelope{data:json!({"data":c}),source:"cache",warning:Some(e.to_string())})}}}
    let c=read_posts(&state,page,&room_id,None)?;
    Ok(Envelope{data:json!({"data":c}),source:"cache",warning:Some("当前显示离线缓存".into())})
}
#[tauri::command] async fn search_posts(state:tauri::State<'_,State>,keywords:String,room_id:String,online:bool)->Result<Envelope>{
    if keywords.trim().is_empty(){return Err(Error::Other("请输入搜索内容".into()))}
    if online {
        let client=http_client()?;
        let mut results=Vec::new();
        let mut seen=HashSet::new();
        let mut warning=None;
        for page in 1..=MAX_SEARCH_PAGES {
            match request_with_client(&client,&state,1,"search",&[
                ("search_mode","1".into()),
                ("page",page.to_string()),
                ("room_id",room_id.clone()),
                ("keywords",keywords.clone()),
                ("pagesize","25".into())
            ],None).await {
                Ok(v)=>{
                    let batch=list(&v);
                    if batch.is_empty(){break}
                    for post in batch {
                        if let Some(pid)=post.get("pid").and_then(Value::as_i64) {
                            if seen.insert(pid){results.push(post.clone())}
                        } else {
                            results.push(post.clone())
                        }
                    }
                    if page==MAX_SEARCH_PAGES {
                        warning=Some(format!("搜索结果超过 {} 条，已达到安全加载上限",MAX_SEARCH_PAGES*25));
                    } else {
                        tokio::time::sleep(Duration::from_millis(80)).await;
                    }
                },
                Err(e)=>{
                    if is_auth_error(&e){return Err(e)}
                    if results.is_empty() {
                        let cached=read_search_all(&state,&room_id,&keywords)?;
                        if cached.is_empty(){return Err(e)}
                        return Ok(Envelope{data:json!({"data":cached}),source:"cache",warning:Some(e.to_string())})
                    }
                    warning=Some(format!("已加载 {} 条结果，后续页面加载失败：{}",results.len(),e));
                    break
                }
            }
        }
        results.sort_by(|left,right|{
            let left_pid=left.get("pid").and_then(Value::as_i64).unwrap_or(i64::MIN);
            let right_pid=right.get("pid").and_then(Value::as_i64).unwrap_or(i64::MIN);
            right_pid.cmp(&left_pid)
        });
        save_posts(&state,&results)?;
        return Ok(Envelope{data:json!({"code":0,"data":results}),source:"online",warning})
    }
    let c=read_search_all(&state,&room_id,&keywords)?;
    Ok(Envelope{data:json!({"data":c}),source:"cache",warning:Some("仅搜索离线缓存".into())})
}
#[tauri::command] async fn get_online_attention(state:tauri::State<'_,State>,room_id:String)->Result<Envelope>{
    match request(&state,1,"getattention",&[],None).await {
        Ok(mut value)=>{
            if let Some(error)=response_error(&value,"线上关注加载失败"){return Err(error)}
            let all=list(&value).to_vec();
            save_posts(&state,&all)?;
            if !room_id.is_empty() {
                let filtered=all.into_iter().filter(|post|{
                    post.get("room_id").map(|room|{
                        room.as_str().map(str::to_owned).unwrap_or_else(||room.to_string())
                    }).as_deref()==Some(room_id.as_str())
                }).collect();
                value["data"]=Value::Array(filtered);
            }
            Ok(Envelope{data:value,source:"online",warning:None})
        },
        Err(error)=>Err(error)
    }
}
#[tauri::command] fn get_local_favorites(state:tauri::State<'_,State>,room_id:String)->Result<Envelope>{
    let posts=read_favorites(&state,&room_id)?;
    Ok(Envelope{data:json!({"data":posts}),source:"cache",warning:None})
}
#[tauri::command] fn is_local_favorite(state:tauri::State<'_,State>,pid:i64)->Result<bool>{
    let db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;
    favorite_exists(&db,pid)
}
#[tauri::command] fn set_local_favorite(state:tauri::State<'_,State>,pid:i64,enabled:bool)->Result<bool>{
    set_favorite_state(&state,pid,enabled)?;
    Ok(enabled)
}
#[tauri::command] async fn get_post(state:tauri::State<'_,State>,pid:i64,online:bool)->Result<Envelope>{
    if online { match request(&state,1,"getone",&[("pid",pid.to_string())],None).await {
      Ok(v)=>{if let Some(p)=v.get("data"){save_posts(&state,std::slice::from_ref(p))?}return Ok(Envelope{data:v,source:"online",warning:None})},
      Err(e) if is_auth_error(&e)=>return Err(e),
      Err(_)=>{}
    }}
    let p=read_post(&state,pid)?.ok_or_else(||Error::Other("离线缓存中没有这篇帖子".into()))?;
    Ok(Envelope{data:json!({"data":p}),source:"cache",warning:Some("当前显示离线缓存".into())})
}
#[tauri::command] async fn get_comments(state:tauri::State<'_,State>,pid:i64,online:bool)->Result<Envelope>{
    if online { match request(&state,1,"getcomment",&[("pid",pid.to_string())],None).await {
      Ok(v)=>{
      let mut db=state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?;let tx=db.transaction()?;tx.execute("DELETE FROM comments WHERE pid=?1",params![pid])?;
      for c in list(&v){if let Some(cid)=c.get("cid").and_then(Value::as_i64){tx.execute("INSERT INTO comments VALUES(?1,?2,?3)",params![pid,cid,c.to_string()])?;}}tx.commit()?;
      return Ok(Envelope{data:v,source:"online",warning:None})},
      Err(e) if is_auth_error(&e)=>return Err(e),
      Err(_)=>{}
    }}
    let c=read_comments(&state,pid)?;
    Ok(Envelope{data:json!({"data":c}),source:"cache",warning:Some("当前显示离线缓存".into())})
}
#[derive(Deserialize)] struct PostInput{text:String,cw:String,room_id:String,allow_search:bool,use_title:bool}
#[tauri::command] async fn create_post(state:tauri::State<'_,State>,input:PostInput)->Result<Value>{
    request(&state,1,"dopost",&[],Some(&[("cw".into(),input.cw),("text".into(),input.text),("room_id".into(),input.room_id),("allow_search".into(),if input.allow_search{"1"}else{""}.into()),("use_title".into(),if input.use_title{"1"}else{""}.into())])).await
}
#[tauri::command] async fn create_comment(state:tauri::State<'_,State>,pid:i64,text:String,use_title:bool)->Result<Value>{
    request(&state,2,&format!("post/{pid}/comment"),&[],Some(&[("text".into(),text),("use_title".into(),if use_title{"1"}else{""}.into())])).await
}
#[tauri::command] async fn set_attention(state:tauri::State<'_,State>,pid:i64,enabled:bool)->Result<Value>{
    let response=request(&state,1,"attention",&[],Some(&[
        ("pid".into(),pid.to_string()),
        ("switch".into(),if enabled{"1"}else{"0"}.into())
    ])).await?;
    if let Some(error)=response_error(&response,"关注操作失败"){return Err(error)}
    save_online_attention_state(&state,pid,enabled,&response)?;
    if enabled {set_favorite_state(&state,pid,true)?}
    Ok(response)
}
#[tauri::command] async fn vote_poll(state:tauri::State<'_,State>,pid:i64,option:String)->Result<Value>{
    let option=option.trim();
    if option.is_empty()||option.len()>512{return Err(Error::Other("投票选项无效".into()))}
    let response=request(&state,1,"vote",&[],Some(&[("vote".into(),option.into()),("pid".into(),pid.to_string())])).await?;
    if response.get("code").and_then(Value::as_i64).is_some_and(|code|code!=0){
        return Err(Error::Other(response.get("msg").and_then(Value::as_str).unwrap_or("投票失败").into()))
    }
    let poll=response.get("data").filter(|value|value.get("answers").and_then(Value::as_array).is_some()).ok_or(Error::InvalidResponse)?;
    update_cached_poll(&state,pid,poll)?;
    Ok(response)
}
#[tauri::command] fn clear_cache(state:tauri::State<'_,State>)->Result<()> {
    state.db.lock().map_err(|_|Error::Storage("缓存不可用".into()))?.execute_batch(
        "DELETE FROM comments WHERE pid NOT IN (SELECT pid FROM favorites);
         DELETE FROM posts WHERE pid NOT IN (SELECT pid FROM favorites);"
    )?;
    Ok(())
}

#[tauri::command]
async fn check_for_update(app:tauri::AppHandle,pending:tauri::State<'_,PendingUpdate>)->Result<UpdateInfo>{
    let current_version=app.package_info().version.to_string();
    let update=app.updater().map_err(|e|Error::Update(e.to_string()))?
        .check().await.map_err(|e|Error::Update(e.to_string()))?;
    let info=UpdateInfo{
        available:update.is_some(),
        current_version,
        version:update.as_ref().map(|release|release.version.clone()),
    };
    *pending.0.lock().map_err(|_|Error::Storage("更新状态不可用".into()))?=update;
    Ok(info)
}

#[tauri::command]
async fn install_update(app:tauri::AppHandle,pending:tauri::State<'_,PendingUpdate>)->Result<()>{
    let update=pending.0.lock().map_err(|_|Error::Storage("更新状态不可用".into()))?
        .take().ok_or_else(||Error::Other("没有待安装的更新，请重新检查".into()))?;
    update.download_and_install(|_,_|{},||{}).await.map_err(|e|Error::Update(e.to_string()))?;
    app.restart()
}

pub fn run(){
 tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build()).setup(|app|{
   let dir=app.path().app_local_data_dir()?;std::fs::create_dir_all(&dir)?;
   let settings=std::fs::read_to_string(dir.join("settings.json")).ok().and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default();
   app.manage(State{db:Mutex::new(init_db(dir.join("newt-cache.sqlite3")).map_err(|e|e.to_string())?),settings:Mutex::new(settings),dir});
   app.manage(PendingUpdate(Mutex::new(None)));Ok(())
 }).invoke_handler(tauri::generate_handler![get_settings,save_settings,start_github_login,test_connection,get_timeline,search_posts,get_online_attention,get_local_favorites,is_local_favorite,set_local_favorite,get_post,get_comments,create_post,create_comment,set_attention,vote_poll,clear_cache,check_for_update,install_update])
 .run(tauri::generate_context!()).expect("启动新T树洞失败");
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn url_normalization(){assert_eq!(normalize_base("https://example.com/_api/v1/").unwrap(),"https://example.com");}
 #[test] fn blocks_plain_http(){assert!(normalize_base("http://example.com").is_err());}
 #[test] fn json_control_chars(){let s=sanitize_json("{\"x\":\"a\u{0007}b\"}");assert!(serde_json::from_str::<Value>(&s).is_ok());}
 #[test] fn extracts_query_login_token(){
   let url=Url::parse("https://new-t.github.io/?token=sha256%3Aabc_123").unwrap();
   assert_eq!(login_callback_token(&url).as_deref(),Some("sha256:abc_123"));
 }
 #[test] fn extracts_fragment_login_token(){
   let url=Url::parse("https://new-t.github.io/###token=abc_123").unwrap();
   assert_eq!(login_callback_token(&url).as_deref(),Some("abc_123"));
 }
 #[test] fn rejects_token_from_other_hosts(){
   let url=Url::parse("https://example.com/?token=abc_123").unwrap();
   assert!(login_callback_token(&url).is_none());
 }
 #[test] fn local_favorites_keep_saved_order(){
   let path=tempfile::NamedTempFile::new().unwrap();
   let mut db=init_db(path.path().to_path_buf()).unwrap();
   cache_posts(&mut db,&[
     json!({"pid":1,"text":"one","timestamp":10}),
     json!({"pid":2,"text":"two","timestamp":20})
   ]).unwrap();
   db.execute("INSERT INTO favorites VALUES(1,100)",[]).unwrap();
   db.execute("INSERT INTO favorites VALUES(2,200)",[]).unwrap();
   let posts=cached_favorites(&db,"").unwrap();
   assert_eq!(posts[0]["pid"],2);
   assert_eq!(posts[1]["pid"],1);
 }
 #[test] fn local_favorite_is_removed_only_explicitly(){
   let path=tempfile::NamedTempFile::new().unwrap();
   let db=init_db(path.path().to_path_buf()).unwrap();
   set_favorite_in_db(&db,42,true).unwrap();
   assert!(favorite_exists(&db,42).unwrap());
   set_favorite_in_db(&db,42,true).unwrap();
   assert!(favorite_exists(&db,42).unwrap());
   set_favorite_in_db(&db,42,false).unwrap();
   assert!(!favorite_exists(&db,42).unwrap());
 }
}
