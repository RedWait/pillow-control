use crate::{
    control::Controller,
    protocol::ClientMessage,
    security::{Limiter, Pairing},
};
use axum::{
    body::{to_bytes, Body},
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Request, State,
    },
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{future::BoxFuture, stream::FuturesUnordered, StreamExt};
use include_dir::{include_dir, Dir};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{
    sync::{watch, Semaphore},
    task::JoinHandle,
};
static MOBILE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../tauri-dist/mobile");

struct Session {
    id: u64,
    cancel: watch::Sender<u16>,
}
struct Limits {
    pair: Limiter,
    total: Limiter,
    upgrade: Limiter,
}
pub struct Context {
    pub origin: String,
    pairing: Mutex<Pairing>,
    limits: Mutex<Limits>,
    active: Mutex<Option<Session>>,
    next: AtomicU64,
    controller: Arc<Controller>,
    slots: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
}
impl Context {
    pub fn connected(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }
    pub fn code(&self) -> String {
        self.pairing.lock().unwrap().code.clone()
    }
    fn disconnect_locked(&self) {
        if let Some(session) = self.active.lock().unwrap().take() {
            let _ = session.cancel.send(4003);
        }
        self.controller.revoke();
    }
    pub fn revoke(&self) -> Result<(), String> {
        let mut p = self.pairing.lock().unwrap();
        let result = p.rotate();
        self.disconnect_locked();
        result
    }
    fn authorize(&self, token: &str) -> Option<(u64, watch::Receiver<u16>)> {
        let pairing = self.pairing.lock().unwrap();
        if !pairing.valid(token) {
            return None;
        }
        let mut active = self.active.lock().unwrap();
        if let Some(old) = active.take() {
            let _ = old.cancel.send(4001);
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = watch::channel(0);
        self.controller.activate(id);
        *active = Some(Session { id, cancel: tx });
        Some((id, rx))
    }
    fn detach(&self, id: u64) {
        let mut active = self.active.lock().unwrap();
        if active.as_ref().is_some_and(|s| s.id == id) {
            *active = None;
            self.controller.release_for(id);
        }
    }
    fn current(&self, id: u64) -> bool {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|s| s.id == id)
    }
    fn host_ok(&self, headers: &HeaderMap) -> bool {
        headers.get("host").and_then(|h| h.to_str().ok())
            == Some(self.origin.trim_start_matches("http://"))
    }
    fn origin_ok(&self, headers: &HeaderMap) -> bool {
        self.host_ok(headers)
            && headers.get("origin").and_then(|h| h.to_str().ok()) == Some(&self.origin)
    }
}
pub struct Server {
    pub context: Arc<Context>,
    pub address: SocketAddr,
    shutdown: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}
impl Server {
    pub async fn start(
        host: std::net::Ipv4Addr,
        port: u16,
        controller: Arc<Controller>,
    ) -> Result<Self, String> {
        Self::start_with_store(host, port, controller, crate::preferences::Store::memory()).await
    }
    pub async fn start_with_store(
        host: std::net::Ipv4Addr,
        port: u16,
        controller: Arc<Controller>,
        store: crate::preferences::SharedStore,
    ) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind((host, port))
            .await
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AddrInUse => {
                    "端口 19827 已被占用，请退出旧版枕控或占用此端口的程序".into()
                }
                _ => format!("无法监听所选地址：{e}"),
            })?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let (tx, rx) = watch::channel(false);
        let context = Arc::new(Context {
            origin: format!("http://{address}"),
            pairing: Mutex::new(Pairing::with_store(store)?),
            limits: Mutex::new(Limits {
                pair: Limiter::new(6, 60),
                total: Limiter::new(30, 60),
                upgrade: Limiter::new(30, 60),
            }),
            active: Mutex::new(None),
            next: AtomicU64::new(1),
            controller,
            slots: Arc::new(Semaphore::new(8)),
            shutdown: rx.clone(),
        });
        let routes = Router::new()
            .route("/ws", get(upgrade))
            .fallback(http)
            .with_state(context.clone());
        let mut stop = rx;
        let task = tokio::spawn(async move {
            let _ = axum::serve(
                crate::transport::LimitedListener::new(listener),
                routes.into_make_service_with_connect_info::<crate::transport::Peer>(),
            )
            .with_graceful_shutdown(async move {
                let _ = stop.changed().await;
            })
            .await;
        });
        Ok(Self {
            context,
            address,
            shutdown: tx,
            task: Some(task),
        })
    }
    pub async fn stop(&mut self) {
        // Stop the active session without forgetting trusted credentials.
        if let Some(session) = self.context.active.lock().unwrap().take() {
            let _ = session.cancel.send(4000);
        }
        self.context.controller.revoke();
        let _ = self.shutdown.send(true);
        if let Some(mut task) = self.task.take() {
            if tokio::time::timeout(Duration::from_secs(3), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        self.context.controller.revoke();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
fn json(status: StatusCode, value: serde_json::Value) -> Response {
    let mut response = (status, axum::Json(value)).into_response();
    let headers = response.headers_mut();
    headers.insert("cache-control", "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    response
}
fn error(status: StatusCode, message: &str) -> Response {
    json(status, serde_json::json!({"error":message}))
}
async fn http(
    State(ctx): State<Arc<Context>>,
    ConnectInfo(peer): ConnectInfo<crate::transport::Peer>,
    request: Request,
) -> Response {
    if !ctx.host_ok(request.headers()) {
        return error(StatusCode::FORBIDDEN, "Host 不匹配");
    }
    let path = request.uri().path().to_owned();
    let method = request.method().clone();
    if path.starts_with("/api/") {
        if !ctx.origin_ok(request.headers()) {
            return error(StatusCode::FORBIDDEN, "来源不匹配");
        }
        if path == "/api/pair" && method == Method::POST {
            {
                let mut limits = ctx.limits.lock().unwrap();
                if !limits.total.allow("all") || !limits.pair.allow(&peer.0.ip().to_string()) {
                    return error(StatusCode::TOO_MANY_REQUESTS, "尝试过于频繁，请等待一分钟");
                }
            }
            if request
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                != Some("application/json")
            {
                return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "需要 JSON");
            }
            let bytes = match tokio::time::timeout(
                Duration::from_secs(5),
                to_bytes(request.into_body(), 2048),
            )
            .await
            {
                Ok(Ok(body)) => body,
                _ => return error(StatusCode::BAD_REQUEST, "请求过大或读取超时"),
            };
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct PairRequest {
                code: String,
            }
            let body: PairRequest = match serde_json::from_slice(&bytes) {
                Ok(b) => b,
                Err(_) => return error(StatusCode::BAD_REQUEST, "请求无效"),
            };
            let mut pairing = ctx.pairing.lock().unwrap();
            return match pairing.pair(&body.code) {
                Ok(Some(token)) => {
                    ctx.disconnect_locked();
                    json(StatusCode::OK, serde_json::json!({"token":token}))
                }
                Ok(None) => error(
                    StatusCode::UNAUTHORIZED,
                    "配对码错误或已过期，请在电脑端重新配对",
                ),
                Err(_) => error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "随机数生成失败，服务拒绝配对",
                ),
            };
        }
        let token = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !ctx.pairing.lock().unwrap().valid(token) {
            return error(StatusCode::UNAUTHORIZED, "需要配对");
        }
        return if path == "/api/status" && method == Method::GET {
            json(
                StatusCode::OK,
                serde_json::json!({"connected":ctx.connected()}),
            )
        } else {
            error(StatusCode::NOT_FOUND, "没有此接口")
        };
    }
    if method != Method::GET && method != Method::HEAD {
        return error(StatusCode::METHOD_NOT_ALLOWED, "不支持的方法");
    }
    let name = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    let asset = name.strip_prefix("assets/").is_some_and(|s| {
        s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            && [".js", ".css", ".svg", ".png", ".woff2"]
                .iter()
                .any(|ext| s.ends_with(ext))
    });
    if name != "index.html" && !asset {
        return error(StatusCode::NOT_FOUND, "未找到");
    }
    let Some(file) = MOBILE.get_file(name) else {
        return error(StatusCode::NOT_FOUND, "页面资源不存在");
    };
    let content_type = if name.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if name.ends_with(".js") {
        "text/javascript"
    } else if name.ends_with(".css") {
        "text/css"
    } else if name.ends_with(".svg") {
        "image/svg+xml"
    } else if name.ends_with(".png") {
        "image/png"
    } else {
        "font/woff2"
    };
    Response::builder().header("content-type",content_type).header("cache-control","no-store").header("x-content-type-options","nosniff").header("referrer-policy","no-referrer")
      .header("content-security-policy",format!("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' {}; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",ctx.origin.replace("http:","ws:")))
      .body(if method==Method::HEAD{Body::empty()}else{Body::from(file.contents())}).unwrap()
}
async fn upgrade(
    State(ctx): State<Arc<Context>>,
    ConnectInfo(peer): ConnectInfo<crate::transport::Peer>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !ctx.origin_ok(&headers)
        || !ctx
            .limits
            .lock()
            .unwrap()
            .upgrade
            .allow(&peer.0.ip().to_string())
    {
        return error(StatusCode::FORBIDDEN, "来源不匹配或请求过于频繁");
    }
    let Ok(slot) = ctx.slots.clone().try_acquire_owned() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "连接过多");
    };
    ws.max_message_size(8192)
        .max_frame_size(8192)
        .max_write_buffer_size(16384)
        .write_buffer_size(0)
        .on_upgrade(move |socket| async move {
            let _slot = slot;
            connection(socket, ctx).await
        })
}
async fn send(socket: &mut WebSocket, value: serde_json::Value) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(1),
            socket.send(Message::Text(value.to_string().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn close(socket: &mut WebSocket, code: u16) {
    let _ = tokio::time::timeout(
        Duration::from_millis(500),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: "PillowControl connection closed".into(),
        }))),
    )
    .await;
}
async fn connection(mut socket: WebSocket, ctx: Arc<Context>) {
    let mut shutdown = ctx.shutdown.clone();
    let first = tokio::select! { _=shutdown.changed()=>{close(&mut socket,4000).await;return;},message=tokio::time::timeout(Duration::from_secs(3),socket.recv())=>message};
    let token = match first {
        Ok(Some(Ok(Message::Text(text)))) => match ClientMessage::parse(&text) {
            Ok(ClientMessage::Auth { token }) => token,
            _ => {
                close(&mut socket, 4003).await;
                return;
            }
        },
        _ => {
            close(&mut socket, 4003).await;
            return;
        }
    };
    let Some((id, mut cancelled)) = ctx.authorize(&token) else {
        close(&mut socket, 4003).await;
        return;
    };
    if !send(&mut socket, serde_json::json!({"kind":"ready"})).await {
        ctx.detach(id);
        return;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_millis(500));
    let mut last_alive = Instant::now();
    let mut last_id = None;
    let mut rate = Limiter::new(100, 1);
    let mut texts = Limiter::new(4, 10);
    let mut pending: FuturesUnordered<
        BoxFuture<'static, (u64, Result<serde_json::Value, String>)>,
    > = FuturesUnordered::new();
    loop {
        tokio::select! {
            biased;
            _=shutdown.changed()=>{close(&mut socket,4000).await;break;},
            _=cancelled.changed()=>{let code=*cancelled.borrow();close(&mut socket,if code==0{4001}else{code}).await;break;},
            _=heartbeat.tick()=>{if last_alive.elapsed()>Duration::from_millis(3500){close(&mut socket,4000).await;break;}},
            Some((sequence,result))=pending.next(),if !pending.is_empty()=>{let mut ack=serde_json::json!({"kind":"ack","id":sequence});if let Err(error)=result{ack["error"]=error.into();}
                if !send(&mut socket,ack).await{break;}},
            frame=socket.recv()=>{
                let Some(Ok(frame))=frame else{break;};if !ctx.current(id){close(&mut socket,4001).await;break;}
                if !rate.allow("messages"){close(&mut socket,4008).await;break;}
                let text=match frame{Message::Text(text)=>text,Message::Close(_)=>break,Message::Ping(_)|Message::Pong(_)=>continue,_=>{close(&mut socket,4002).await;break;}};
                let data=match ClientMessage::parse(&text){Ok(data)=>data,Err(_)=>{close(&mut socket,4002).await;break;}};
                match data {
                    ClientMessage::Ping{}=>{last_alive=Instant::now();if !send(&mut socket,serde_json::json!({"kind":"pong"})).await{break;}},
                    ClientMessage::Auth{..}=>{close(&mut socket,4002).await;break;},
                    ClientMessage::Command{id:sequence,command}=>{
                        if last_id.is_some_and(|last|sequence<=last){close(&mut socket,4002).await;break;}last_id=Some(sequence);
                        if pending.len()>=32 || (matches!(command,crate::protocol::Command::Text{..})&&!texts.allow("text")){if !send(&mut socket,serde_json::json!({"kind":"ack","id":sequence,"error":"操作过于频繁，已丢弃"})).await{break;}continue;}
                        let rx=ctx.controller.submit(id,command);pending.push(Box::pin(async move{let result=match tokio::time::timeout(Duration::from_secs(4),rx).await{Ok(Ok(result))=>result,Ok(Err(_))=>Err("控制线程已退出".into()),Err(_)=>Err("操作确认超时，结果未知；不会自动重发".into())};(sequence,result)}));
                    }
                }
            }
        }
    }
    ctx.detach(id);
}
