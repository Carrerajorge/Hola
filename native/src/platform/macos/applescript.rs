use napi_derive::napi;
use napi::Result;
use std::process::Command;

#[napi]
pub fn execute_applescript(script: String) -> Result<String> {
  // Fallback para legacy OS control
  let output = Command::new("osascript")
    .arg("-e")
    .arg(&script)
    .output()
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
  } else {
    Err(napi::Error::from_reason(String::from_utf8_lossy(&output.stderr).to_string()))
  }
}
