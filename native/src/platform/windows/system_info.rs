#![cfg(target_os = "windows")]
use napi_derive::napi;
use napi::Result;

#[napi]
pub fn get_battery_level() -> Result<f64> {
  // En Windows se usa CallNtPowerInformation o WMI Win32_Battery. 
  // Para compilar la librería limpiamente y exponer la firma FFI 
  // devolvemos placeholder as always.
  Ok(100.0)
}

#[napi]
pub fn get_os_version() -> Result<String> {
  Ok(format!("Windows {}", std::env::consts::ARCH))
}
