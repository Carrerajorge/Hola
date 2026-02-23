#![cfg(target_os = "windows")]
use napi_derive::napi;
use napi::Result;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, INPUT_KEYBOARD,
    MOUSEINPUT, KEYBDINPUT,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_ABSOLUTE, 
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN};
use std::mem::size_of;

#[napi]
pub fn mouse_click(x: f64, y: f64, button: i32) -> Result<()> {
    unsafe {
        let mut inputs = [INPUT::default(), INPUT::default()];
        let (down_flag, up_flag) = if button == 2 {
            (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
        } else {
            (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
        };

        inputs[0].r#type = INPUT_MOUSE;
        inputs[0].Anonymous.mi = MOUSEINPUT {
            dx: 0,
            dy: 0,
            mouseData: 0,
            dwFlags: down_flag,
            time: 0,
            dwExtraInfo: 0,
        };

        inputs[1].r#type = INPUT_MOUSE;
        inputs[1].Anonymous.mi = MOUSEINPUT {
            dx: 0,
            dy: 0,
            mouseData: 0,
            dwFlags: up_flag,
            time: 0,
            dwExtraInfo: 0,
        };

        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[napi]
pub fn mouse_move(x: f64, y: f64) -> Result<()> {
    unsafe {
        let sw = GetSystemMetrics(SM_CXVIRTUALSCREEN) as f64;
        let sh = GetSystemMetrics(SM_CYVIRTUALSCREEN) as f64;
        
        // Coordenadas absolutas de Windows van de 0 a 65535 mapadeadas a la res de pantalla
        let dx = (x * 65535.0 / sw) as i32;
        let dy = (y * 65535.0 / sh) as i32;

        let mut input = INPUT::default();
        input.r#type = INPUT_MOUSE;
        input.Anonymous.mi = MOUSEINPUT {
            dx,
            dy,
            mouseData: 0,
            dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
            time: 0,
            dwExtraInfo: 0,
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[napi]
pub fn keyboard_type(text: String) -> Result<()> {
    unsafe {
        let utf16_chars: Vec<u16> = text.encode_utf16().collect();
        let mut inputs: Vec<INPUT> = Vec::with_capacity(utf16_chars.len() * 2);

        for c in utf16_chars {
             let mut in_down = INPUT::default();
             in_down.r#type = INPUT_KEYBOARD;
             in_down.Anonymous.ki = KEYBDINPUT {
                 wVk: VIRTUAL_KEY(0),
                 wScan: c,
                 dwFlags: KEYEVENTF_UNICODE,
                 time: 0,
                 dwExtraInfo: 0,
             };
             inputs.push(in_down);

             let mut in_up = INPUT::default();
             in_up.r#type = INPUT_KEYBOARD;
             in_up.Anonymous.ki = KEYBDINPUT {
                 wVk: VIRTUAL_KEY(0),
                 wScan: c,
                 dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                 time: 0,
                 dwExtraInfo: 0,
             };
             inputs.push(in_up);
        }
        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
    Ok(())
}

fn get_vk_code(key: &str) -> u16 {
    match key.to_lowercase().as_str() {
        "a" => 0x41, "b" => 0x42, "c" => 0x43, "d" => 0x44, "e" => 0x45, "f" => 0x46,
        "g" => 0x47, "h" => 0x48, "i" => 0x49, "j" => 0x4A, "k" => 0x4B, "l" => 0x4C,
        "m" => 0x4D, "n" => 0x4E, "o" => 0x4F, "p" => 0x50, "q" => 0x51, "r" => 0x52,
        "s" => 0x53, "t" => 0x54, "u" => 0x55, "v" => 0x56, "w" => 0x57, "x" => 0x58,
        "y" => 0x59, "z" => 0x5A,
        "0" => 0x30, "1" => 0x31, "2" => 0x32, "3" => 0x33, "4" => 0x34,
        "5" => 0x35, "6" => 0x36, "7" => 0x37, "8" => 0x38, "9" => 0x39,
        "return" | "enter" => 0x0D,
        "tab" => 0x09,
        "space" => 0x20,
        "delete" => 0x2E,
        "backspace" => 0x08,
        "escape" | "esc" => 0x1B,
        "command" | "cmd" | "meta" | "win" | "super" => 0x5B,
        "shift" => 0x10,
        "capslock" => 0x14,
        "option" | "alt" => 0x12,
        "control" | "ctrl" => 0x11,
        "left" => 0x25, "up" => 0x26, "right" => 0x27, "down" => 0x28,
        "f1" => 0x70, "f2" => 0x71, "f3" => 0x72, "f4" => 0x73, "f5" => 0x74, "f6" => 0x75,
        "f7" => 0x76, "f8" => 0x77, "f9" => 0x78, "f10" => 0x79, "f11" => 0x7A, "f12" => 0x7B,
        _ => 0,
    }
}

#[napi]
pub fn keyboard_press(key_name: String) -> Result<()> {
    let vk = get_vk_code(&key_name);
    if vk == 0 {
        return Err(napi::Error::new(napi::Status::InvalidArg, format!("Unknown key: {}", key_name)));
    }

    unsafe {
        let mut inputs = [INPUT::default(), INPUT::default()];
        
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0), time: 0, dwExtraInfo: 0,
        };

        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0,
        };

        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[napi]
pub fn mouse_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Result<()> {
    unsafe {
        let sw = GetSystemMetrics(SM_CXVIRTUALSCREEN) as f64;
        let sh = GetSystemMetrics(SM_CYVIRTUALSCREEN) as f64;
        
        let dx_from = (from_x * 65535.0 / sw) as i32;
        let dy_from = (from_y * 65535.0 / sh) as i32;
        
        let dx_to = (to_x * 65535.0 / sw) as i32;
        let dy_to = (to_y * 65535.0 / sh) as i32;

        let mut inputs = [INPUT::default(), INPUT::default(), INPUT::default(), INPUT::default()];
        
        // Move to start
        inputs[0].r#type = INPUT_MOUSE;
        inputs[0].Anonymous.mi = MOUSEINPUT {
            dx: dx_from, dy: dy_from, mouseData: 0, dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, time: 0, dwExtraInfo: 0,
        };
        
        // Down
        inputs[1].r#type = INPUT_MOUSE;
        inputs[1].Anonymous.mi = MOUSEINPUT {
            dx: dx_from, dy: dy_from, mouseData: 0, dwFlags: MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE, time: 0, dwExtraInfo: 0,
        };
        
        // Move to end
        inputs[2].r#type = INPUT_MOUSE;
        inputs[2].Anonymous.mi = MOUSEINPUT {
            dx: dx_to, dy: dy_to, mouseData: 0, dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, time: 0, dwExtraInfo: 0,
        };

        // Up
        inputs[3].r#type = INPUT_MOUSE;
        inputs[3].Anonymous.mi = MOUSEINPUT {
            dx: dx_to, dy: dy_to, mouseData: 0, dwFlags: MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE, time: 0, dwExtraInfo: 0,
        };

        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[napi]
pub fn mouse_scroll(_x: f64, _y: f64, _delta_x: i32, delta_y: i32) -> Result<()> {
    unsafe {
        let mut input = INPUT::default();
        input.r#type = INPUT_MOUSE;
        input.Anonymous.mi = MOUSEINPUT {
            dx: 0, dy: 0, mouseData: (delta_y * 120) as u32, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0,
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
    Ok(())
}
