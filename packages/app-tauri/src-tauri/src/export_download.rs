use serde::Serialize;
use crate::download_format::DownloadFormat;
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager, webview::DownloadEvent};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ExportDownloads(Mutex<DownloadState>);
#[derive(Default)]
struct DownloadState { active: Option<DownloadTask>, abandoned: Vec<DownloadTask> }
struct DownloadTask {
    id: String, url: String, size: u64, format: DownloadFormat, target: Option<PathBuf>, folder: Option<PathBuf>, started: bool, cancelled: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadResult { id: String, status: &'static str, error: Option<String> }

fn cleanup(task: &DownloadTask) -> Result<(), String> {
    if let Some(folder) = &task.folder {
        if folder.exists() { fs::remove_dir_all(folder).map_err(|_| "导出文件临时文件清理失败，请检查保存目录中的 .odv-export 临时目录")?; }
    }
    Ok(())
}
pub fn is_busy(app: &tauri::AppHandle) -> bool {
    app.state::<ExportDownloads>().0.lock().map(|pending| pending.active.is_some()).unwrap_or(true)
}
fn take(app: &tauri::AppHandle, id: &str) -> Option<DownloadTask> {
    let state = app.state::<ExportDownloads>();
    let mut pending = state.0.lock().ok()?;
    if pending.active.as_ref().map(|task| task.id.as_str()) == Some(id) { pending.active.take() } else { None }
}
fn valid_request(id: &str, url: &str, size: u64, format: DownloadFormat) -> bool {
    // macOS 使用自定义协议；WebView2 默认映射为 http，可由 useHttpsScheme 改为 https。
    let origin = url.starts_with("blob:tauri://localhost/")
        || url.starts_with("blob:http://tauri.localhost/")
        || url.starts_with("blob:https://tauri.localhost/")
        || (cfg!(debug_assertions) && url.starts_with("blob:http://127.0.0.1:5174/"));
    origin && id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && format.valid_size(size)
}
fn staging_folder(target: &Path, id: &str) -> Result<PathBuf, String> {
    let parent = target.parent().ok_or("保存位置无效")?;
    if target.exists() { return Err("目标已存在，请选择新的文件名；原文件不会被覆盖".into()); }
    let folder = parent.join(format!(".odv-export-{}-{id}", std::process::id()));
    fs::create_dir(&folder).map_err(|_| "无法创建导出文件临时目录，请检查保存权限")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).is_err() {
            let _ = fs::remove_dir(&folder);
            return Err("无法限制导出文件临时目录权限".into());
        }
    }
    Ok(folder)
}

#[tauri::command]
pub async fn prepare_export_download(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, url: String, size: u64, format: DownloadFormat) -> Result<String, String> {
    if window.label() != "main" || !valid_request(&id, &url, size, format) { return Err("导出文件下载请求无效".into()); }
    {
        let state = app.state::<ExportDownloads>();
        let mut pending = state.0.lock().map_err(|_| "导出文件保存状态不可用")?;
        if pending.active.is_some() { return Err("已有导出文件正在保存，请稍后重试".into()); }
        pending.abandoned.retain(|task| cleanup(task).is_err());
        if pending.abandoned.len() >= 4 { return Err("先前下载仍未结束，请检查 .odv-export 临时目录并重新启动应用后重试".into()); }
        pending.active = Some(DownloadTask { id: id.clone(), url, size, format, target: None, folder: None, started: false, cancelled: false });
    }
    let result = prepare_target(&app, &id, format);
    if result.as_ref().map(|value| value != "ready").unwrap_or(true) {
        if let Some(task) = take(&app, &id) { cleanup(&task)?; }
    }
    result
}
fn prepare_target(app: &tauri::AppHandle, id: &str, format: DownloadFormat) -> Result<String, String> {
    let selected = app.dialog().file().set_title("保存导出文件（请选择新文件名）")
        .add_filter(format.label(), &[format.extension()]).set_file_name(format.filename()).blocking_save_file();
    let Some(selected) = selected else { return Ok("cancelled".into()); };
    let target = selected.into_path().map_err(|_| "无法访问导出文件保存位置")?;
    let folder = staging_folder(&target, id)?;
    let state = app.state::<ExportDownloads>();
    let mut pending = state.0.lock().map_err(|_| "导出文件保存状态不可用")?;
    if let Some(task) = pending.active.as_mut().filter(|task| task.id == id) {
        task.target = Some(target); task.folder = Some(folder); Ok("ready".into())
    } else {
        let _ = fs::remove_dir(&folder); Ok("cancelled".into())
    }
}
#[tauri::command]
pub fn cancel_export_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<ExportDownloads>();
    let mut pending = state.0.lock().map_err(|_| "导出文件保存状态不可用")?;
    cancel_task(&mut pending, &id)?;
    Ok(())
}
fn cancel_task(pending: &mut DownloadState, id: &str) -> Result<(), String> {
    if pending.active.as_ref().map(|task| task.id.as_str()) != Some(id) { return Ok(()); }
    let Some(mut task) = pending.active.take() else { return Ok(()); };
    if task.started {
        // 墓碑不占活动槽位：即使 Finished 缺失，超时后仍可关闭应用。
        task.cancelled = true;
        pending.abandoned.push(task);
        Ok(())
    } else {
        let result = cleanup(&task);
        if result.is_err() { task.cancelled = true; pending.abandoned.push(task); }
        result
    }
}
fn finished_task(pending: &mut DownloadState, url: &str) -> Option<DownloadTask> {
    if pending.active.as_ref().is_some_and(|task| task.url == url && task.started) { return pending.active.take(); }
    let index = pending.abandoned.iter().position(|task| task.url == url)?;
    Some(pending.abandoned.remove(index))
}
fn finish(task: &DownloadTask, success: bool) -> Result<(), String> {
    let result = if task.cancelled { Ok(()) } else if success { publish(task) } else { Err("导出文件下载失败，请重试".into()) };
    cleanup(task).and(result)
}

fn publish(task: &DownloadTask) -> Result<(), String> {
    let folder = task.folder.as_ref().ok_or("导出文件临时目录不存在")?;
    let source = folder.join(task.format.filename());
    let target = task.target.as_ref().ok_or("导出文件保存位置不存在")?;
    let metadata = fs::symlink_metadata(&source).map_err(|_| "未收到完整导出文件文件")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != task.size {
        return Err("导出文件下载不完整，未写入目标文件".into());
    }
    let mut file = fs::OpenOptions::new().read(true).write(true).open(&source).map_err(|_| "无法读取导出文件临时文件")?;
    task.format.validate(&mut file)?;
    file.sync_all().map_err(|_| "导出文件同步写盘失败")?;
    // 不使用 rename 覆盖用户文件；完整下载后才无覆盖发布。
    fs::hard_link(&source, target).map_err(|_| "无法保存导出文件；目标已存在或保存位置不支持，请选择新文件名")?;
    Ok(())
}

pub fn handle_download(webview: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    let app = webview.app_handle();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let state = app.state::<ExportDownloads>();
            let Ok(mut pending) = state.0.lock() else { return false; };
            let Some(task) = pending.active.as_mut().filter(|task| task.url == url.as_str() && !task.started) else { return false; };
            let Some(folder) = &task.folder else { return false; };
            *destination = folder.join(task.format.filename()); task.started = true; true
        }
        DownloadEvent::Finished { url, success, .. } => {
            let task = {
                let state = app.state::<ExportDownloads>();
                let Ok(mut pending) = state.0.lock() else { return false; };
                finished_task(&mut pending, url.as_str())
            };
            if let Some(task) = task {
                let result = finish(&task, success);
                let retry_cleanup = task.folder.as_ref().is_some_and(|folder| folder.exists());
                let _ = app.emit_to("main", "desktop-export-result", DownloadResult {
                    id: task.id.clone(), status: if result.is_err() { "failed" } else if task.cancelled { "cancelled" } else { "saved" }, error: result.err(),
                });
                if retry_cleanup {
                    if let Ok(mut pending) = app.state::<ExportDownloads>().0.lock() {
                        let mut task = task; task.cancelled = true; pending.abandoned.push(task);
                    }
                }
            }
            true
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "export_download_tests.rs"]
mod tests;
