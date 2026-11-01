#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

static SELECTION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedFile {
    id: String,
    name: String,
    path: String,
    size: u64,
}

fn io_error(error: std::io::Error) -> String {
    format!("读取所选内容失败：{error}")
}

// 只索引用户选择/拖入的内容；不跟随符号链接，不依据扩展名筛掉 DICOMDIR 或无扩展文件。
fn collect(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_file() {
        files.push(path.to_owned());
    } else if metadata.is_dir() {
        let mut children = fs::read_dir(path)
            .map_err(io_error)?
            .map(|entry| entry.map(|e| e.path()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        children.sort();
        for child in children {
            collect(&child, files)?;
        }
    }
    Ok(())
}

fn index_paths(paths: &[PathBuf]) -> Result<Vec<SelectedFile>, String> {
    let Some(first) = paths.first() else {
        return Ok(vec![]);
    };
    let mut base = first.parent().ok_or("无法确定所选路径的父目录")?.to_owned();
    for path in paths {
        while !path.starts_with(&base) {
            if !base.pop() {
                return Err("所选文件不属于同一可索引根目录".into());
            }
        }
    }
    let mut files = vec![];
    for path in paths {
        collect(path, &mut files)?;
    }
    files.sort();
    files.dedup();
    if files.is_empty() {
        return Err("所选内容没有可读取的普通文件；空目录或符号链接不能作为影像导入".into());
    }
    let selection = SELECTION.fetch_add(1, Ordering::Relaxed);
    files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(&base).map_err(|_| "无法生成相对路径")?;
            let relative = relative
                .to_str()
                .ok_or("所选路径包含无法表示的字符")?
                .replace('\\', "/");
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("无法读取文件名")?
                .to_owned();
            let size = fs::metadata(&path).map_err(io_error)?.len();
            let native = path
                .to_str()
                .ok_or("所选路径包含无法表示的字符")?
                .to_owned();
            Ok(SelectedFile {
                id: format!("desktop-{selection}/{relative}"),
                name,
                path: native,
                size,
            })
        })
        .collect()
}

fn grant_selected(app: &tauri::AppHandle, paths: &[PathBuf]) -> Result<Vec<SelectedFile>, String> {
    let files = index_paths(paths)?;
    // 初始 scope 为空；逐个授权已索引的文件，绝不放开 HOME 或整个磁盘。
    let scope = app.asset_protocol_scope();
    for file in &files {
        scope
            .allow_file(&file.path)
            .map_err(|_| "无法授权所选文件的本地读取")?;
    }
    Ok(files)
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle, mode: String) -> Result<Vec<SelectedFile>, String> {
    let picker = app.dialog().file();
    let paths = match mode.as_str() {
        "files" => picker
            .set_title("打开 DICOM 文件或 ZIP")
            .blocking_pick_files()
            .unwrap_or_default(),
        "folder" => picker
            .set_title("打开影像文件夹")
            .blocking_pick_folder()
            .into_iter()
            .collect(),
        _ => return Err("未知文件选择方式".into()),
    };
    let paths = paths
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| "无法访问所选本地路径".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    grant_selected(&app, &paths)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![pick_files])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let app = window.app_handle().clone();
                let paths = paths.clone();
                tauri::async_runtime::spawn_blocking(move || match grant_selected(&app, &paths) {
                    Ok(files) => {
                        let _ = app.emit_to("main", "desktop-files", files);
                    }
                    Err(error) => {
                        let _ = app.emit_to("main", "desktop-import-error", error);
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("桌面运行时初始化失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "odv-index-test-{}-{}",
            std::process::id(),
            SELECTION.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn index_keeps_relative_paths_and_extensionless_files() {
        let root = folder();
        fs::create_dir(root.join("SERIES")).unwrap();
        fs::write(root.join("DICOMDIR"), [0u8; 8]).unwrap();
        fs::write(root.join("SERIES/000001"), [1u8; 16]).unwrap();
        let files = index_paths(std::slice::from_ref(&root)).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files[1].id.ends_with("/SERIES/000001"));
        assert_eq!(files[1].size, 16);
        assert_eq!(files[0].name, "DICOMDIR");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selecting_one_file_does_not_index_its_neighbours() {
        let root = folder();
        fs::write(root.join("selected.dcm"), [0u8; 4]).unwrap();
        fs::write(root.join("other.dcm"), [0u8; 4]).unwrap();
        let files = index_paths(&[root.join("selected.dcm")]).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "selected.dcm");
        assert!(index_paths(&[root.join("missing")]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn directory_symlinks_do_not_expand_the_selection() {
        let root = folder();
        let outside = folder();
        fs::write(outside.join("private.dcm"), [0u8; 4]).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        assert!(index_paths(std::slice::from_ref(&root)).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
