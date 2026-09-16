//! Real official-plugin HTTP/download/signature tests using an in-process fixture.
//! Public test vector from minisign-verify 0.2.5 (MIT); no private key is present.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::time::Duration;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;
const PUBLIC: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
const SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
#[tokio::test]
async fn official_plugin_download_checks_signatures_and_rejects_failures() {
    use axum::{routing::get, Json, Router};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let signature = STANDARD.encode(SIGNATURE);
    let public = STANDARD.encode(PUBLIC);
    let mut context = mock_context(noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), serde_json::json!({"pubkey":public}));
    let app = mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public.clone())
                .build(),
        )
        .build(context)
        .unwrap();
    let make = |version: &str, path: &str| {
        serde_json::json!({
            "version":version, "pub_date":"2026-09-16T00:00:00Z","notes":"test fixture",
            "platforms":{"windows-x86_64":{"signature":signature,"url":format!("{origin}/{path}")}}
        })
    };
    let good = make("99.0.0", "good");
    let bad = make("99.0.0", "bad");
    let fail = make("99.0.0", "missing");
    let old = make("0.0.0", "good");
    let router = Router::new()
        .route("/good.json", get(move || async move { Json(good) }))
        .route("/bad.json", get(move || async move { Json(bad) }))
        .route("/fail.json", get(move || async move { Json(fail) }))
        .route("/old.json", get(move || async move { Json(old) }))
        .route("/good", get(|| async { "test" }))
        .route("/bad", get(|| async { "Test" }));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let builder = |path: &str| {
        app.updater_builder()
            .target("windows-x86_64")
            .endpoints(vec![format!("{origin}/{path}").parse().unwrap()])
            .unwrap()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    };
    assert!(builder("old.json").check().await.unwrap().is_none());
    let update = builder("good.json").check().await.unwrap().unwrap();
    let mut progress = 0;
    let bytes = update.download(|n, _| progress += n, || {}).await.unwrap();
    assert_eq!(bytes, b"test");
    assert_eq!(progress, 4);
    pillow_control::updates::verify_signature(&bytes, &signature, &public).unwrap();
    assert!(pillow_control::updates::verify_signature(b"Test", &signature, &public).is_err());
    assert!(builder("bad.json")
        .check()
        .await
        .unwrap()
        .unwrap()
        .download(|_, _| {}, || {})
        .await
        .is_err());
    assert!(builder("fail.json")
        .check()
        .await
        .unwrap()
        .unwrap()
        .download(|_, _| {}, || {})
        .await
        .is_err());
    server.abort();
    let _ = server.await;
    assert!(builder("good.json").check().await.is_err());
    // Never call install: payload is test data, not an executable.
}
