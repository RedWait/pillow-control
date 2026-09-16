use pillow_control::{
    control::{Controller, Native},
    protocol::{Button, Command, Key},
};
use serde_json::{json, Value};
use std::sync::{mpsc, Arc, Mutex};
struct Blocker {
    calls: Arc<Mutex<Vec<Command>>>,
    started: mpsc::SyncSender<()>,
    resume: mpsc::Receiver<()>,
    first: bool,
}
impl Native for Blocker {
    fn execute(&mut self, c: &Command) -> Result<(), String> {
        self.calls.lock().unwrap().push(c.clone());
        if self.first {
            self.first = false;
            self.started.send(()).unwrap();
            self.resume.recv().unwrap();
        }
        Ok(())
    }
    fn release(&mut self) -> Result<(), String> {
        self.calls.lock().unwrap().push(Command::Release {});
        Ok(())
    }
    fn probe(&mut self) -> Result<Value, String> {
        Ok(json!(true))
    }
}
type Fixture = (
    Arc<Controller>,
    Arc<Mutex<Vec<Command>>>,
    mpsc::Receiver<()>,
    mpsc::SyncSender<()>,
);
fn fixture() -> Fixture {
    let calls = Arc::new(Mutex::new(vec![]));
    let clone = calls.clone();
    let (started, started_rx) = mpsc::sync_channel(1);
    let (resume, resume_rx) = mpsc::sync_channel(1);
    let c = Controller::start(move || {
        Ok(Box::new(Blocker {
            calls: clone,
            started,
            resume: resume_rx,
            first: true,
        }))
    })
    .unwrap();
    c.activate(1);
    (c, calls, started_rx, resume)
}
#[tokio::test]
async fn disconnect_cancels_queued_clicks_and_old_disconnect_cannot_release_new_session() {
    let (c, calls, started, resume) = fixture();
    let first = c.submit(1, Command::Key { key: Key::Space });
    started.recv().unwrap();
    let click = c.submit(
        1,
        Command::Click {
            button: Button::Left,
            count: 1,
        },
    );
    let shutdown = c.submit(1, Command::Shutdown { confirmed: true });
    let lens = c.submit(1, Command::Magnifier { enabled: true });
    c.release_for(1);
    assert!(click.await.unwrap().is_err());
    assert!(shutdown.await.unwrap().is_err());
    assert!(lens.await.unwrap().is_err());
    c.activate(2);
    c.release_for(1);
    let new = c.submit(2, Command::Key { key: Key::Enter });
    resume.send(()).unwrap();
    first.await.unwrap().unwrap();
    new.await.unwrap().unwrap();
    c.probe().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Command::Release {},
            Command::Key { key: Key::Space },
            Command::Release {},
            Command::Key { key: Key::Enter }
        ]
    );
    c.shutdown();
    assert!(c.submit(2, Command::Release {}).await.unwrap().is_err());
}
#[tokio::test]
async fn coalesces_bounded_moves_and_rejects_overflow() {
    let (c, calls, started, resume) = fixture();
    let first = c.submit(1, Command::Key { key: Key::Space });
    started.recv().unwrap();
    let a = c.submit(1, Command::Move { dx: 300, dy: 0 });
    let b = c.submit(1, Command::Move { dx: 300, dy: 1 });
    let mut replies = vec![];
    for _ in 0..40 {
        replies.push(c.submit(1, Command::Key { key: Key::Left }));
    }
    resume.send(()).unwrap();
    first.await.unwrap().unwrap();
    a.await.unwrap().unwrap();
    b.await.unwrap().unwrap();
    let mut rejected = 0;
    for reply in replies {
        if reply.await.unwrap().is_err() {
            rejected += 1;
        }
    }
    assert_eq!(rejected, 25);
    assert_eq!(calls.lock().unwrap()[2], Command::Move { dx: 500, dy: 1 });
    c.shutdown();
}

struct SessionNative(Arc<Mutex<Vec<&'static str>>>);
impl Native for SessionNative {
    fn execute(&mut self, _: &Command) -> Result<(), String> {
        self.0.lock().unwrap().push("command");
        Ok(())
    }
    fn release(&mut self) -> Result<(), String> {
        self.0.lock().unwrap().push("release");
        Ok(())
    }
    fn end_session(&mut self) -> Result<(), String> {
        self.0.lock().unwrap().push("end-session");
        Ok(())
    }
    fn probe(&mut self) -> Result<Value, String> {
        Ok(json!(null))
    }
}
#[tokio::test]
async fn session_end_cleans_accessibility_resources_but_gesture_release_does_not() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let copy = events.clone();
    let c = Controller::start(move || Ok(Box::new(SessionNative(copy)))).unwrap();
    c.activate(1);
    c.probe().await.unwrap();
    c.submit(1, Command::Magnifier { enabled: true })
        .await
        .unwrap()
        .unwrap();
    c.submit(1, Command::Release {}).await.unwrap().unwrap();
    assert_eq!(
        *events.lock().unwrap(),
        vec!["end-session", "command", "release"]
    );
    c.release_for(1);
    c.probe().await.unwrap();
    assert_eq!(events.lock().unwrap().last(), Some(&"end-session"));
    c.shutdown();
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| **e == "end-session")
            .count(),
        3
    );
}
