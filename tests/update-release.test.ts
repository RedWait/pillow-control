import { describe, it, expect } from "vitest";
// @ts-expect-error maintainer scripts are native ESM
import { stable, names, metadata, assertMetadata, sourceFileHash } from "../scripts/update-release-lib.mjs";
describe("stable signed release manifest", () => {
  it("ignores only Cargo manifest line endings, never content or binary changes", () => {
    const lf = Buffer.from('[package]\nversion = "0.3.0"\n');
    const crlf = Buffer.from(lf.toString().replace(/\n/g, "\r\n"));
    expect(sourceFileHash("src-tauri/Cargo.toml", lf)).toBe(sourceFileHash("src-tauri/Cargo.toml", crlf));
    expect(sourceFileHash("src-tauri/Cargo.toml", lf)).not.toBe(sourceFileHash("src-tauri/Cargo.toml", Buffer.from('[package]\nversion = "0.3.1"\n')));
    expect(sourceFileHash("asset.bin", lf)).not.toBe(sourceFileHash("asset.bin", crlf));
    expect(sourceFileHash("package.json", lf)).not.toBe(sourceFileHash("package.json", crlf));
  });
  it("uses real Windows x64 NSIS names and version-bound URLs", () => {
    const m = metadata("0.3.0", "encoded-signature", "Release notes", "2026-09-16T00:00:00Z");
    expect(m.platforms["windows-x86_64"].url).toBe("https://github.com/RedWait/pillow-control/releases/download/v0.3.0/pillow-control-0.3.0-setup-x64.exe");
    expect(names("0.3.0").signature).toBe("pillow-control-0.3.0-setup-x64.exe.sig");
    expect(() => assertMetadata(m, "0.3.0", "encoded-signature")).not.toThrow();
    m.platforms["windows-x86_64"].url = "https://example.com/other.exe";
    expect(() => assertMetadata(m, "0.3.0", "encoded-signature")).toThrow();
  });
  it("rejects prerelease, malformed version, absent signature and mismatch", () => {
    for (const v of ["v1.0.0", "1.0.0-beta", "1.0", "01.0.0", "../1.0.0"]) expect(() => stable(v)).toThrow();
    expect(() => metadata("1.0.0", "", "notes")).toThrow();
    const m = metadata("1.0.0", "sig", "notes");
    expect(() => assertMetadata(m, "1.0.1", "sig")).toThrow();
    expect(() => assertMetadata(m, "1.0.0", "other-sig")).toThrow();
  });
});
