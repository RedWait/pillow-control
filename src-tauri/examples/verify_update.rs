fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = (|| -> Result<(), String> {
        if args.len() != 3 {
            return Err("Usage: verify_update INSTALLER SIGNATURE PUBLIC_KEY_FILE".into());
        }
        let bytes = std::fs::read(&args[0]).map_err(|e| e.to_string())?;
        let signature = std::fs::read_to_string(&args[1]).map_err(|e| e.to_string())?;
        let key = std::fs::read_to_string(&args[2]).map_err(|e| e.to_string())?;
        pillow_control::updates::verify_signature(&bytes, &signature, &key)
    })();
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("Update signature verified.");
}
