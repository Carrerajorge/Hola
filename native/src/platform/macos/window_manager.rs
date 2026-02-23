use napi_derive::napi;
use napi::Result;
use crate::types::{WindowInfo, Rect};

#[napi]
pub fn get_active_window() -> Result<WindowInfo> {
  Ok(WindowInfo {
    id: 1,
    title: "Focused Window".to_string(),
    app_name: "App".to_string(),
    is_focused: true,
    bounds: Rect { x: 0.0, y: 0.0, width: 800.0, height: 600.0 },
    z_order: 0,
  })
}

#[napi]
pub fn list_windows() -> Result<Vec<WindowInfo>> {
  Ok(vec![get_active_window()?])
}

#[napi]
pub fn focus_window(_window_id: i64) -> Result<bool> {
  Ok(true)
}

#[napi]
pub fn close_window(_window_id: i64) -> Result<bool> {
  Ok(true)
}
