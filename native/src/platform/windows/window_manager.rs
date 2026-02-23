#![cfg(target_os = "windows")]
use napi_derive::napi;
use napi::Result;
use crate::types::{WindowInfo, Rect};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, EnumWindows, GetWindowRect, 
    IsWindowVisible, SetForegroundWindow, PostMessageW, WM_CLOSE
};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let vec_ptr = lparam.0 as *mut Vec<WindowInfo>;
    let vec = &mut *vec_ptr;

    if IsWindowVisible(hwnd).as_bool() {
        let mut text_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut text_buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&text_buf[..len as usize]);
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);
            
            vec.push(WindowInfo {
                id: hwnd.0 as i64,
                title,
                app_name: String::new(),
                is_focused: false,
                bounds: Rect { 
                    x: rect.left as f64, 
                    y: rect.top as f64, 
                    width: (rect.right - rect.left) as f64, 
                    height: (rect.bottom - rect.top) as f64 
                },
                z_order: vec.len() as i32,
            });
        }
    }
    BOOL(1)
}

#[napi]
pub fn get_active_window() -> Result<WindowInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut text_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut text_buf);
        let title = String::from_utf16_lossy(&text_buf[..len as usize]);
        
        // Rect details
        let mut rect = windows::Win32::Foundation::RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);

        Ok(WindowInfo {
            id: hwnd.0 as i64,
            title,
            app_name: "WindowsApp".to_string(), // Requires GetWindowThreadProcessId logic
            is_focused: true,
            bounds: Rect { 
                x: rect.left as f64, 
                y: rect.top as f64, 
                width: (rect.right - rect.left) as f64, 
                height: (rect.bottom - rect.top) as f64 
            },
            z_order: 0,
        })
    }
}

#[napi]
pub fn list_windows() -> Result<Vec<WindowInfo>> {
    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut windows as *mut _ as isize)
        );
    }
    Ok(windows)
}

#[napi]
pub fn focus_window(hwnd: i64) -> Result<bool> {
    unsafe {
        SetForegroundWindow(HWND(hwnd as *mut _));
    }
    Ok(true)
}

#[napi]
pub fn close_window(hwnd: i64) -> Result<bool> {
    unsafe {
        let _ = PostMessageW(
            HWND(hwnd as *mut _),
            WM_CLOSE,
            WPARAM(0),
            LPARAM(0)
        );
    }
    Ok(true)
}
