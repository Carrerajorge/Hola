use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use napi::{Result, JsFunction, Error, Status};
use std::process::Command;
use std::ffi::c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGMainDisplayID() -> u32;
    fn CGDisplayCreateImage(displayID: u32) -> *mut c_void;
    fn CGWindowListCreateImage(
        screenBounds: CGRect,
        listOption: u32,
        windowID: u32,
        imageOption: u32
    ) -> *mut c_void; 
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut u32,
        display_count: *mut u32
    ) -> i32;
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageDestinationCreateWithData(
        data: *mut c_void, 
        utType: *const c_void, 
        count: usize, 
        options: *const c_void
    ) -> *mut c_void;
    
    fn CGImageDestinationAddImage(idst: *mut c_void, image: *mut c_void, properties: *const c_void);
    fn CGImageDestinationFinalize(idst: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
    fn CFDataGetBytePtr(theData: *const c_void) -> *const u8;
    fn CFDataGetLength(theData: *const c_void) -> isize;
    fn CFRelease(cf: *mut c_void);
    fn CFStringCreateWithCString(alloc: *const c_void, cStr: *const i8, encoding: u32) -> *mut c_void;
}

// OS X defined types
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    x: f64, y: f64, width: f64, height: f64
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

fn create_cfstring(s: &str) -> *mut c_void {
    let c_str = std::ffi::CString::new(s).unwrap();
    unsafe { CFStringCreateWithCString(std::ptr::null(), c_str.as_ptr(), K_CF_STRING_ENCODING_UTF8) }
}

#[napi(object)]
pub struct CaptureHandle {
    pub id: i64,
    pub active: bool,
}

#[napi]
pub fn capture_screen(_display_id: u32) -> Result<Buffer> {
    unsafe {
        let display_id = CGMainDisplayID();
        let target_display = if _display_id == 0 { display_id } else { _display_id };
        
        let cg_image = CGDisplayCreateImage(target_display);
        if cg_image.is_null() {
            return Err(Error::new(Status::GenericFailure, "CGDisplayCreateImage returned null".to_string()));
        }

        let mut_data = CFDataCreateMutable(std::ptr::null(), 0);
        if mut_data.is_null() {
            CFRelease(cg_image);
            return Err(Error::new(Status::GenericFailure, "CFDataCreateMutable returned null".to_string()));
        }

        let ut_type_jpeg = create_cfstring("public.jpeg");
        
        let dest = CGImageDestinationCreateWithData(mut_data, ut_type_jpeg, 1, std::ptr::null());
        CFRelease(ut_type_jpeg);
        
        if dest.is_null() {
            CFRelease(mut_data);
            CFRelease(cg_image);
            return Err(Error::new(Status::GenericFailure, "CGImageDestinationCreateWithData null".to_string()));
        }

        CGImageDestinationAddImage(dest, cg_image, std::ptr::null());
        
        let success = CGImageDestinationFinalize(dest);
        CFRelease(dest);
        CFRelease(cg_image);

        if !success {
            CFRelease(mut_data);
            return Err(Error::new(Status::GenericFailure, "CGImageDestinationFinalize failed".to_string()));
        }

        let length = CFDataGetLength(mut_data) as usize;
        let ptr = CFDataGetBytePtr(mut_data);
        
        let buffer = std::slice::from_raw_parts(ptr, length).to_vec();
        CFRelease(mut_data);
        
        Ok(Buffer::from(buffer))
    }
}

#[napi]
pub fn capture_all_screens() -> Result<Vec<Buffer>> {
    unsafe {
        let mut display_count: u32 = 0;
        let mut displays: [u32; 16] = [0; 16];
        
        let err = CGGetActiveDisplayList(16, displays.as_mut_ptr(), &mut display_count);
        if err != 0 {
            return Err(Error::new(Status::GenericFailure, format!("CGGetActiveDisplayList failed: {}", err)));
        }

        let mut buffers = Vec::new();
        for i in 0..display_count as usize {
            let display_id = displays[i];
            if let Ok(buf) = capture_screen(display_id) {
                buffers.push(buf);
            }
        }
        
        Ok(buffers)
    }
}

#[napi]
pub fn capture_region(x: i32, y: i32, w: i32, h: i32) -> Result<Buffer> {
    let temp_path = "/tmp/iliagpt_capture_region.jpg";
    let rect_str = format!("{},{},{},{}", x, y, w, h);
    
    let status = Command::new("screencapture")
        .args(["-x", "-R", &rect_str, "-t", "jpg", temp_path])
        .status()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to exec screencapture region: {}", e)))?;
        
    if !status.success() {
       return Err(Error::new(Status::GenericFailure, "screencapture region exit code non-zero".to_string()));
    }

    let data = std::fs::read(temp_path)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Cannot read region buf: {}", e)))?;
        
    Ok(Buffer::from(data))
}

#[napi]
pub fn capture_window(window_id: u32) -> Result<Buffer> {
    let temp_path = format!("/tmp/iliagpt_capture_win_{}.jpg", window_id);
    // '-l' flag captura un specific window ID
    let status = Command::new("screencapture")
        .args(["-x", "-l", &window_id.to_string(), "-t", "jpg", &temp_path])
        .status()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to exec screencapture win: {}", e)))?;
        
    if !status.success() {
       return Err(Error::new(Status::GenericFailure, "screencapture win exit code non-zero".to_string()));
    }

    let data = std::fs::read(&temp_path)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Cannot read win buf: {}", e)))?;
        
    Ok(Buffer::from(data))
}

#[napi]
pub fn start_continuous_capture(_fps: u32, _callback: JsFunction) -> Result<CaptureHandle> {
  // Simulador de stream IPC
  Ok(CaptureHandle { id: 1, active: true })
}

#[napi]
pub fn stop_continuous_capture(_handle: CaptureHandle) -> Result<()> {
  Ok(())
}
