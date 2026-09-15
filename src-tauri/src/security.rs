use crate::protocol::valid_token_shape;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

pub struct Pairing {
    pub code: String,
    store: crate::preferences::SharedStore,
    expires: Instant,
}
fn random_code() -> Result<String, String> {
    loop {
        let mut b = [0; 4];
        getrandom::fill(&mut b).map_err(|e| e.to_string())?;
        let n = u32::from_le_bytes(b);
        let bound = u32::MAX - u32::MAX % 900_000;
        if n < bound {
            return Ok((100_000 + n % 900_000).to_string());
        }
    }
}
impl Pairing {
    pub fn new() -> Result<Self, String> {
        Self::with_store(crate::preferences::Store::memory())
    }
    pub fn with_store(store: crate::preferences::SharedStore) -> Result<Self, String> {
        Ok(Self {
            code: random_code()?,
            store,
            expires: Instant::now() + Duration::from_secs(600),
        })
    }
    pub fn rotate(&mut self) -> Result<(), String> {
        self.store
            .lock()
            .unwrap()
            .update(|p| p.token_digest = None)?;
        self.code = random_code()?;
        self.expires = Instant::now() + Duration::from_secs(600);
        Ok(())
    }
    pub fn pair(&mut self, code: &str) -> Result<Option<String>, String> {
        if Instant::now() > self.expires
            || code.len() != 6
            || !bool::from(self.code.as_bytes().ct_eq(code.as_bytes()))
        {
            return Ok(None);
        }
        let mut token = [0; 32];
        getrandom::fill(&mut token).map_err(|e| e.to_string())?;
        let token = hex::encode(token);
        let next = random_code()?;
        self.store.lock().unwrap().update(|p| {
            p.token_digest = Some(hex::encode(Sha256::digest(token.as_bytes())));
            // Honor an explicit opt-out; the first pairing enables silent login startup.
            if p.autostart.is_none() {
                p.autostart = Some(true);
            }
        })?;
        self.code = next;
        self.expires = Instant::now() + Duration::from_secs(600);
        Ok(Some(token))
    }
    pub fn valid(&self, token: &str) -> bool {
        valid_token_shape(token)
            && self
                .store
                .lock()
                .unwrap()
                .get()
                .token_digest
                .as_ref()
                .is_some_and(|expected| {
                    bool::from(
                        expected
                            .as_bytes()
                            .ct_eq(hex::encode(Sha256::digest(token.as_bytes())).as_bytes()),
                    )
                })
    }
}
pub struct Limiter {
    max: u32,
    window: Duration,
    entries: HashMap<String, (u32, Instant)>,
}
impl Limiter {
    pub fn new(max: u32, seconds: u64) -> Self {
        Self {
            max,
            window: Duration::from_secs(seconds),
            entries: HashMap::new(),
        }
    }
    pub fn allow(&mut self, key: &str) -> bool {
        self.allow_at(key, Instant::now())
    }
    fn allow_at(&mut self, key: &str, now: Instant) -> bool {
        self.entries.retain(|_, v| v.1 > now);
        if !self.entries.contains_key(key) && self.entries.len() >= 1024 {
            return false;
        }
        let value = self
            .entries
            .entry(key.into())
            .or_insert((0, now + self.window));
        value.0 = value.0.saturating_add(1);
        value.0 <= self.max
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_lifecycle() {
        let mut p = Pairing::new().unwrap();
        assert!(p.pair("wrong").unwrap().is_none());
        let token = p.pair(&p.code.clone()).unwrap().unwrap();
        assert!(p.valid(&token));
        let second = p.pair(&p.code.clone()).unwrap().unwrap();
        assert!(!p.valid(&token));
        assert!(p.valid(&second));
        p.rotate().unwrap();
        assert!(!p.valid(&second));
    }
    #[test]
    fn expiration() {
        let mut p = Pairing::new().unwrap();
        p.expires = Instant::now() - Duration::from_secs(1);
        assert!(p.pair(&p.code.clone()).unwrap().is_none());
    }
    #[test]
    fn bounded_rate() {
        let now = Instant::now();
        let mut r = Limiter::new(2, 60);
        assert!(r.allow_at("a", now));
        assert!(r.allow_at("a", now));
        assert!(!r.allow_at("a", now));
        assert!(r.allow_at("a", now + Duration::from_secs(61)));
    }
}
