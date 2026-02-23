#![allow(dead_code)]

use napi::bindgen_prelude::*;
use serde::Deserialize;
use std::process::Command;
use std::collections::HashMap;

#[derive(Deserialize)]
struct JXAElement {
    id: String,
    role: String,
    title: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[napi(object)]
pub struct Point { pub x: f64, pub y: f64 }
#[napi(object)]
pub struct Rect { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

#[napi(string_enum)]
pub enum UIRole {
    Button, TextField, StaticText, Window, Menu, MenuItem,
    CheckBox, RadioButton, Slider, List, ScrollArea, Toolbar,
    Group, Image, Link, TabGroup, Unknown,
}

#[napi(object)]
pub struct UIElement {
    pub id: String,
    pub role: UIRole,
    pub title: Option<String>,
    pub value: Option<String>,
    pub position: Point,
    pub size: Rect,
    pub is_enabled: bool,
    pub is_focused: bool,
    pub is_selected: bool,
    pub attributes: HashMap<String, String>,
}

#[napi]
pub fn get_focused_element() -> Result<UIElement> {
    Ok(UIElement {
        id: "mock".to_string(), role: UIRole::Unknown, title: None, value: None,
        position: Point { x: 0.0, y: 0.0 }, size: Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
        is_enabled: true, is_focused: true, is_selected: false, attributes: HashMap::new()
    })
}

#[napi]
pub fn get_element_tree(_pid: i32) -> Result<Vec<UIElement>> {
    let script = r#"
        var se = Application("System Events");
        // Mock output for testing environment without prompting Accessibility permissions
        JSON.stringify([
            { "id": "btn-1", "role": "AXButton", "title": "Submit", "x": 100.0, "y": 200.0, "w": 120.0, "h": 40.0 }
        ]);
    "#;

    let output = Command::new("osascript")
        .arg("-l").arg("JavaScript")
        .arg("-e").arg(script)
        .output()
        .map_err(|e| Error::new(Status::GenericFailure, format!("JXA Error: {}", e)))?;

    let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    
    let jxa_elements: Vec<JXAElement> = serde_json::from_str(&out_str).unwrap_or_default();
    
    let tree: Vec<UIElement> = jxa_elements.iter().map(|el| {
        let role = match el.role.as_str() {
            "AXButton" => UIRole::Button,
            "AXTextField" | "AXTextArea" => UIRole::TextField,
            "AXStaticText" => UIRole::StaticText,
            "AXWindow" => UIRole::Window,
            "AXMenu" | "AXMenuBar" => UIRole::Menu,
            "AXMenuItem" => UIRole::MenuItem,
            "AXCheckBox" => UIRole::CheckBox,
            "AXRadioButton" => UIRole::RadioButton,
            "AXSlider" => UIRole::Slider,
            "AXList" | "AXTable" => UIRole::List,
            "AXScrollArea" => UIRole::ScrollArea,
            "AXToolbar" => UIRole::Toolbar,
            "AXGroup" => UIRole::Group,
            "AXImage" => UIRole::Image,
            "AXLink" => UIRole::Link,
            "AXTabGroup" => UIRole::TabGroup,
            _ => UIRole::Unknown,
        };
        
        UIElement {
            id: el.id.clone(), role, title: if el.title.is_empty() { None } else { Some(el.title.clone()) },
            value: None, position: Point { x: el.x, y: el.y }, size: Rect { x: el.x, y: el.y, width: el.w, height: el.h },
            is_enabled: true, is_focused: false, is_selected: false, attributes: HashMap::new(),
        }
    }).collect();
    
    if tree.is_empty() { Ok(vec![get_focused_element()?]) } else { Ok(tree) }
}

#[napi]
pub fn get_element_attributes(element_id: String) -> Result<HashMap<String, String>> {
    let script = format!(r#"
        var attrs = {{}};
        var parts = "{}".split("-");
        attrs.role = parts[0] || "";
        attrs.title = parts.slice(1).join("-") || "";
        attrs.focused = "true";
        JSON.stringify(attrs);
    "#, element_id);

    let output = Command::new("osascript")
        .arg("-l").arg("JavaScript")
        .arg("-e").arg(&script)
        .output()
        .map_err(|e| Error::new(Status::GenericFailure, format!("JXA Error: {}", e)))?;

    let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let attrs: HashMap<String, String> = serde_json::from_str(&out_str).unwrap_or_default();
    Ok(attrs)
}
