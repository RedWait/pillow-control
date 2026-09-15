use std::future::Future;
use std::{
    io,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, Sleep},
};
pub struct LimitedListener {
    listener: TcpListener,
    slots: Arc<Semaphore>,
}
#[derive(Clone, Copy)]
pub struct Peer(pub SocketAddr);
impl axum::extract::connect_info::Connected<axum::serve::IncomingStream<'_, LimitedListener>>
    for Peer
{
    fn connect_info(stream: axum::serve::IncomingStream<'_, LimitedListener>) -> Self {
        Self(*stream.remote_addr())
    }
}
impl LimitedListener {
    pub fn new(listener: TcpListener) -> Self {
        Self {
            listener,
            slots: Arc::new(Semaphore::new(32)),
        }
    }
}
pub struct LimitedStream {
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
    idle: Pin<Box<Sleep>>,
}
impl axum::serve::Listener for LimitedListener {
    type Io = LimitedStream;
    type Addr = SocketAddr;
    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.listener.accept().await {
                Ok((stream, address)) => {
                    // WebSocket acknowledgements are tiny and latency-sensitive.
                    // Do not let Nagle hold them behind an unacknowledged packet.
                    if stream.set_nodelay(true).is_err() {
                        continue;
                    }
                    if let Ok(permit) = self.slots.clone().try_acquire_owned() {
                        return (
                            LimitedStream {
                                stream,
                                _permit: permit,
                                idle: Box::pin(tokio::time::sleep(Duration::from_secs(5))),
                            },
                            address,
                        );
                    }
                    drop(stream);
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    }
    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}
impl AsyncRead for LimitedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match Pin::new(&mut self.stream).poll_read(cx, buf) {
            Poll::Ready(result) => {
                self.idle
                    .as_mut()
                    .reset(Instant::now() + Duration::from_secs(5));
                Poll::Ready(result)
            }
            Poll::Pending => {
                if self.idle.as_mut().poll(cx).is_ready() {
                    Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "connection idle timeout",
                    )))
                } else {
                    Poll::Pending
                }
            }
        }
    }
}
impl AsyncWrite for LimitedStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::serve::Listener;

    #[tokio::test]
    async fn accepted_connections_disable_nagle() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut listener = LimitedListener::new(listener);
        let (_, (accepted, _)) = tokio::join!(TcpStream::connect(address), listener.accept());
        assert!(accepted.stream.nodelay().unwrap());
    }
}
