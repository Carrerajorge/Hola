use napi_derive::napi;
use napi::Result;

#[napi]
pub fn get_battery_level() -> Result<f64> {
  // Stub for IOKit / IOPowerSources
  Ok(100.0)
}

#[napi]
pub fn get_display_count() -> Result<u32> {
  // NSScreen / CGDisplay
  Ok(1)
}

#[napi]
pub fn get_os_version() -> Result<String> {
  Ok("15.0.0".to_string())
}
