//! Stdio diagnostics for testing the exact executable; never reachable over HTTP or IPC.
use crate::{control::Controller, server::Server, windows_control::WindowsControl};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
pub async fn run() {
    let store = crate::preferences::Store::memory();
    let native_store = store.clone();
    let controller =
        Controller::start(move || Ok(Box::new(WindowsControl::with_store(native_store)?)))
            .expect("Windows control");
    let mut server = Some(
        Server::start(std::net::Ipv4Addr::LOCALHOST, 0, controller.clone())
            .await
            .expect("server"),
    );
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            match line {
                Ok(line) => {
                    if tx.blocking_send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let output = |v: Value| {
        println!("{v}");
        let _ = std::io::stdout().flush();
    };
    output(
        json!({"ready":true,"origin":server.as_ref().unwrap().context.origin,"code":server.as_ref().unwrap().context.code()}),
    );
    while let Some(line) = rx.recv().await {
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let action = request["action"].as_str().unwrap_or("");
        let result:Result<Value,String>=match action {
            "probe"=>controller.probe().await,
            "halo-settings"=>serde_json::from_value::<crate::preferences::HaloSettings>(request["value"].clone()).map_err(|e|e.to_string()).and_then(|halo|store.lock().unwrap().update(|p|p.halo=halo)).map(|_|Value::Null),
            "restore-volume"=>controller.restore_volume(request["value"].as_f64().unwrap_or(0.5) as f32).await.map(|_|Value::Null),
            "state"=>Ok(server.as_ref().map(|s|json!({"origin":s.context.origin,"code":s.context.code(),"connected":s.context.connected()})).unwrap_or(Value::Null)),
            "revoke"=>server.as_ref().ok_or("stopped".to_string()).and_then(|s|s.context.revoke()).map(|_|Value::Null),
            "stop"|"quit"=>{if let Some(mut s)=server.take(){s.stop().await;}Ok(Value::Null)},
            "start"=>{if server.is_none(){server=Server::start(std::net::Ipv4Addr::LOCALHOST,0,controller.clone()).await.ok();}Ok(server.as_ref().map(|s|json!({"origin":s.context.origin,"code":s.context.code()})).unwrap_or(Value::Null))},
            _=>Err("Unknown local diagnostic".into())
        };
        output(match result {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        });
        if action == "quit" {
            break;
        }
    }
    if let Some(mut s) = server {
        s.stop().await;
    }
    controller.shutdown();
}
