use pillow_control::protocol::ClientMessage;
#[test]
fn same_cases_as_typescript() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../shared/protocol-cases.json")).unwrap();
    for case in cases.as_array().unwrap() {
        assert_eq!(
            ClientMessage::parse(&case["message"].to_string()).is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}
