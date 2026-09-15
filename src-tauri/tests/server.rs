use futures_util::{SinkExt, StreamExt};
use pillow_control::{
    control::{Controller, Native},
    protocol::Command,
    server::Server,
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
struct Fake(Arc<Mutex<Vec<Command>>>);
impl Native for Fake {
    fn execute(&mut self, c: &Command) -> Result<(), String> {
        self.0.lock().unwrap().push(c.clone());
        Ok(())
    }
    fn release(&mut self) -> Result<(), String> {
        self.0.lock().unwrap().push(Command::Release {});
        Ok(())
    }
}
type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
async fn fixture() -> (Server, Arc<Controller>, Arc<Mutex<Vec<Command>>>) {
    let calls = Arc::new(Mutex::new(vec![]));
    let c = calls.clone();
    let controller = Controller::start(move || Ok(Box::new(Fake(c)))).unwrap();
    (
        Server::start(std::net::Ipv4Addr::LOCALHOST, 0, controller.clone())
            .await
            .unwrap(),
        controller,
        calls,
    )
}
async fn socket(s: &Server) -> Socket {
    let mut request = format!("{}/ws", s.context.origin.replace("http:", "ws:"))
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", s.context.origin.parse().unwrap());
    connect_async(request).await.unwrap().0
}
async fn pair(s: &Server) -> String {
    reqwest::Client::new()
        .post(format!("{}/api/pair", s.context.origin))
        .header("origin", &s.context.origin)
        .json(&json!({"code":s.context.code()}))
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}
async fn send(ws: &mut Socket, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}
async fn receive(ws: &mut Socket) -> Message {
    tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn auth(ws: &mut Socket, token: &str) {
    send(ws, json!({"kind":"auth","token":token})).await;
    assert_eq!(
        receive(ws).await.into_text().unwrap(),
        r#"{"kind":"ready"}"#
    );
}
fn closed(m: Message, code: u16) {
    match m {
        Message::Close(Some(f)) => assert_eq!(u16::from(f.code), code),
        _ => panic!("expected close: {m:?}"),
    }
}
#[tokio::test]
async fn websocket_origin_size_and_message_rate() {
    let (mut s, c, calls) = fixture().await;
    let mut request = format!("{}/ws", s.context.origin.replace("http:", "ws:"))
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", "http://evil.test".parse().unwrap());
    let error = connect_async(request).await.unwrap_err();
    assert!(matches!(error,tokio_tungstenite::tungstenite::Error::Http(ref r) if r.status()==403));
    let mut ws = socket(&s).await;
    ws.send(Message::Text("x".repeat(9000).into()))
        .await
        .unwrap();
    // Axum may reset oversized frames without a close handshake; either must terminate with no control.
    let result = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap();
    assert!(!matches!(result, Some(Ok(Message::Text(_)))));
    let token = pair(&s).await;
    let mut ws = socket(&s).await;
    auth(&mut ws, &token).await;
    for _ in 0..101 {
        ws.feed(Message::Text(r#"{"kind":"ping"}"#.into()))
            .await
            .unwrap();
    }
    ws.flush().await.unwrap();
    loop {
        let message = receive(&mut ws).await;
        if matches!(message, Message::Close(_)) {
            closed(message, 4008);
            break;
        }
    }
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .all(|c| *c == Command::Release {}));
    s.stop().await;
    c.shutdown();
}
#[tokio::test]
async fn http_security_resources_and_pairing_rate() {
    let (mut s, c, _) = fixture().await;
    let client = reqwest::Client::new();
    let origin = &s.context.origin;
    let page = client.get(origin).send().await.unwrap();
    assert!(page.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("connect-src 'self' ws://"));
    assert!(page.text().await.unwrap().contains("枕控 PillowControl"));
    for path in [
        "/package.json",
        "/src-tauri/Cargo.toml",
        "/assets/..%2fCargo.toml",
    ] {
        assert_eq!(
            client
                .get(format!("{origin}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
    }
    assert_eq!(
        client
            .get(origin)
            .header("host", "evil.test")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{origin}/api/pair"))
            .header("origin", "http://evil.test")
            .json(&json!({"code":s.context.code()}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    for path in ["/api/status", "/api/control"] {
        assert_eq!(
            client
                .get(format!("{origin}{path}"))
                .header("origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
    }
    let token = pair(&s).await;
    assert_eq!(
        client
            .get(format!("{origin}/api/status"))
            .header("origin", origin)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(format!("{origin}/api/control"))
            .header("origin", origin)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    for _ in 0..5 {
        assert_eq!(
            client
                .post(format!("{origin}/api/pair"))
                .header("origin", origin)
                .json(&json!({"code":"wrong"}))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
    }
    assert_eq!(
        client
            .post(format!("{origin}/api/pair"))
            .header("origin", origin)
            .json(&json!({"code":s.context.code()}))
            .send()
            .await
            .unwrap()
            .status(),
        429
    );
    s.stop().await;
    c.shutdown();
}
#[tokio::test]
async fn authentication_revocation_replay_disconnect_and_stop() {
    let (mut s, c, calls) = fixture().await;
    let mut unauth = socket(&s).await;
    send(
        &mut unauth,
        json!({"kind":"command","id":0,"command":{"type":"click","button":"left","count":1}}),
    )
    .await;
    closed(receive(&mut unauth).await, 4003);
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .all(|c| *c == Command::Release {}));
    let token = pair(&s).await;
    let mut ws = socket(&s).await;
    auth(&mut ws, &token).await;
    let command =
        json!({"kind":"command","id":1,"command":{"type":"click","button":"left","count":1}});
    send(&mut ws, command.clone()).await;
    assert!(receive(&mut ws).await.into_text().unwrap().contains("ack"));
    send(&mut ws, command).await;
    closed(receive(&mut ws).await, 4002);
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| matches!(c, Command::Click { .. }))
            .count(),
        1
    );
    assert_eq!(calls.lock().unwrap().last(), Some(&Command::Release {}));
    let mut ws = socket(&s).await;
    auth(&mut ws, &token).await;
    s.context.revoke().unwrap();
    closed(receive(&mut ws).await, 4003);
    let mut ws = socket(&s).await;
    send(&mut ws, json!({"kind":"auth","token":token})).await;
    closed(receive(&mut ws).await, 4003);
    let address = s.address;
    s.stop().await;
    assert!(tokio::net::TcpStream::connect(address).await.is_err());
    let mut replacement = Server::start(std::net::Ipv4Addr::LOCALHOST, address.port(), c.clone())
        .await
        .unwrap();
    replacement.stop().await;
    c.shutdown();
}
#[tokio::test]
async fn takeover_and_malformed_commands_and_heartbeat() {
    let (mut s, c, calls) = fixture().await;
    let token = pair(&s).await;
    let mut old = socket(&s).await;
    auth(&mut old, &token).await;
    let mut new = socket(&s).await;
    auth(&mut new, &token).await;
    closed(receive(&mut old).await, 4001);
    send(
        &mut new,
        json!({"kind":"command","id":1,"command":{"type":"release","extra":true}}),
    )
    .await;
    closed(receive(&mut new).await, 4002);
    let mut new = socket(&s).await;
    auth(&mut new, &token).await;
    let frame = tokio::time::timeout(Duration::from_secs(5), new.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    closed(frame, 4000);
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .all(|c| *c == Command::Release {}));
    s.stop().await;
    c.shutdown();
}

#[tokio::test]
async fn saved_credential_authenticates_after_service_and_store_restart() {
    use pillow_control::preferences::Store;
    let path = std::env::temp_dir().join(format!(
        "pillow-server-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let (_, c, _) = fixture().await;
    let mut first = Server::start_with_store(
        std::net::Ipv4Addr::LOCALHOST,
        0,
        c.clone(),
        Store::open(path.clone()).unwrap(),
    )
    .await
    .unwrap();
    let token = pair(&first).await;
    let mut ws = socket(&first).await;
    auth(&mut ws, &token).await;
    first.stop().await;
    closed(receive(&mut ws).await, 4000);
    drop(first);
    let mut second = Server::start_with_store(
        std::net::Ipv4Addr::LOCALHOST,
        0,
        c.clone(),
        Store::open(path.clone()).unwrap(),
    )
    .await
    .unwrap();
    let mut ws = socket(&second).await;
    auth(&mut ws, &token).await;
    second.context.revoke().unwrap();
    closed(receive(&mut ws).await, 4003);
    second.stop().await;
    let mut third = Server::start_with_store(
        std::net::Ipv4Addr::LOCALHOST,
        0,
        c.clone(),
        Store::open(path.clone()).unwrap(),
    )
    .await
    .unwrap();
    let mut ws = socket(&third).await;
    send(&mut ws, json!({"kind":"auth","token":token})).await;
    closed(receive(&mut ws).await, 4003);
    third.stop().await;
    c.shutdown();
    std::fs::remove_file(path).unwrap();
}
