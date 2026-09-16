use crate::protocol::Command;
use std::{
    collections::VecDeque,
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

pub trait Native: Send + 'static {
    fn execute(&mut self, command: &Command) -> Result<(), String>;
    fn release(&mut self) -> Result<(), String>;
    fn end_session(&mut self) -> Result<(), String> {
        self.release()
    }
    fn probe(&mut self) -> Result<serde_json::Value, String> {
        Err("诊断不可用".into())
    }
    fn restore_volume(&mut self, _value: f32) -> Result<(), String> {
        Err("诊断不可用".into())
    }
}
type Reply = oneshot::Sender<Result<serde_json::Value, String>>;
enum Work {
    Command(Command),
    Release,
    EndSession,
    Probe,
    Restore(f32),
}
struct Job {
    work: Work,
    replies: Vec<Reply>,
}
struct Queue {
    jobs: VecDeque<Job>,
    session: u64,
    closing: bool,
}
struct Inner {
    queue: Mutex<Queue>,
    wake: Condvar,
}
pub struct Controller {
    inner: Arc<Inner>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}
impl Controller {
    pub fn start(
        factory: impl FnOnce() -> Result<Box<dyn Native>, String> + Send + 'static,
    ) -> Result<Arc<Self>, String> {
        let inner = Arc::new(Inner {
            queue: Mutex::new(Queue {
                jobs: VecDeque::new(),
                session: 0,
                closing: false,
            }),
            wake: Condvar::new(),
        });
        let worker_inner = inner.clone();
        let (init_tx, init_rx) = std::sync::mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            let mut native = match factory() {
                Ok(n) => {
                    let _ = init_tx.send(Ok(()));
                    n
                }
                Err(e) => {
                    let _ = init_tx.send(Err(e));
                    return;
                }
            };
            let mut last = Instant::now();
            loop {
                let mut q = worker_inner.queue.lock().unwrap();
                if q.closing {
                    drop(q);
                    let _ = native.end_session();
                    break;
                }
                if let Some(job) = q.jobs.pop_front() {
                    drop(q);
                    let result = match job.work {
                        Work::Command(command) => {
                            last = Instant::now();
                            native.execute(&command).map(|_| serde_json::Value::Null)
                        }
                        Work::EndSession => native.end_session().map(|_| serde_json::Value::Null),
                        Work::Release => native.release().map(|_| serde_json::Value::Null),
                        Work::Probe => native.probe(),
                        Work::Restore(value) => native
                            .restore_volume(value)
                            .map(|_| serde_json::Value::Null),
                    };
                    if result.is_err() {
                        let _ = native.release();
                    }
                    for reply in job.replies {
                        let _ = reply.send(result.clone());
                    }
                } else {
                    let (q, _) = worker_inner
                        .wake
                        .wait_timeout(q, Duration::from_millis(250))
                        .unwrap();
                    drop(q);
                    if last.elapsed() > Duration::from_secs(3) {
                        let _ = native.release();
                    }
                }
            }
        });
        init_rx.recv().map_err(|_| "Windows 控制线程无法启动")??;
        Ok(Arc::new(Self {
            inner,
            worker: Mutex::new(Some(worker)),
        }))
    }
    fn clear(q: &mut Queue) {
        for job in q.jobs.drain(..) {
            for tx in job.replies {
                let _ = tx.send(Err("连接变化，操作已取消".into()));
            }
        }
    }
    pub fn activate(&self, session: u64) {
        let mut q = self.inner.queue.lock().unwrap();
        Self::clear(&mut q);
        q.session = session;
        q.jobs.push_front(Job {
            work: Work::EndSession,
            replies: vec![],
        });
        self.inner.wake.notify_one();
    }
    pub fn release_for(&self, session: u64) {
        let mut q = self.inner.queue.lock().unwrap();
        if q.session != session {
            return;
        }
        Self::clear(&mut q);
        q.session = 0;
        q.jobs.push_front(Job {
            work: Work::EndSession,
            replies: vec![],
        });
        self.inner.wake.notify_one();
    }
    pub fn revoke(&self) {
        self.activate(0);
    }
    pub fn submit(
        &self,
        session: u64,
        command: Command,
    ) -> oneshot::Receiver<Result<serde_json::Value, String>> {
        let (tx, rx) = oneshot::channel();
        let mut q = self.inner.queue.lock().unwrap();
        if q.closing || session == 0 || q.session != session {
            let _ = tx.send(Err("连接已失效".into()));
            return rx;
        }
        if let Err(error) = command.validate() {
            let _ = tx.send(Err(error));
            return rx;
        }
        if matches!(command, Command::Release {}) {
            Self::clear(&mut q);
            q.jobs.push_front(Job {
                work: Work::Release,
                replies: vec![tx],
            });
            self.inner.wake.notify_one();
            return rx;
        }
        if let Command::Move { dx, dy } = command {
            if let Some(Job {
                work: Work::Command(Command::Move { dx: x, dy: y }),
                replies,
            }) = q.jobs.back_mut()
            {
                if replies.len() < 32 {
                    *x = (*x + dx).clamp(-500, 500);
                    *y = (*y + dy).clamp(-500, 500);
                    replies.push(tx);
                    return rx;
                }
            }
        }
        if q.jobs.len() >= 16 {
            let _ = tx.send(Err("控制繁忙，指令已丢弃".into()));
            return rx;
        }
        q.jobs.push_back(Job {
            work: Work::Command(command),
            replies: vec![tx],
        });
        self.inner.wake.notify_one();
        rx
    }
    async fn diagnostic(&self, work: Work) -> Result<serde_json::Value, String> {
        let (tx, rx) = oneshot::channel();
        {
            let mut q = self.inner.queue.lock().unwrap();
            if q.closing || q.jobs.len() >= 16 {
                return Err("控制不可用".into());
            }
            q.jobs.push_back(Job {
                work,
                replies: vec![tx],
            });
            self.inner.wake.notify_one();
        }
        tokio::time::timeout(Duration::from_secs(4), rx)
            .await
            .map_err(|_| "诊断超时")?
            .map_err(|_| "控制线程已退出")?
    }
    pub async fn probe(&self) -> Result<serde_json::Value, String> {
        self.diagnostic(Work::Probe).await
    }
    pub async fn restore_volume(&self, value: f32) -> Result<(), String> {
        self.diagnostic(Work::Restore(value)).await.map(|_| ())
    }
    pub fn shutdown(&self) {
        {
            let mut q = self.inner.queue.lock().unwrap();
            Self::clear(&mut q);
            q.closing = true;
            self.inner.wake.notify_one();
        }
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}
impl Drop for Controller {
    fn drop(&mut self) {
        self.shutdown();
    }
}
