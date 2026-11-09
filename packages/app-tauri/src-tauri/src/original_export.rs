use crate::{io_error, AuthorizedOriginals, SELECTION};
use serde::Deserialize;
use std::{fs, path::Path, sync::atomic::Ordering};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
pub(super) struct OriginalRequest { id: String, size: u64 }

fn copy_original(source: &Path, target: &Path, expected_size: u64) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(io_error)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != expected_size {
        return Err("源文件已变化，请重新导入后再导出".into());
    }
    let parent = target.parent().ok_or("无法确定保存目录")?;
    let temp = parent.join(format!(".odv-original-{}-{}.tmp", std::process::id(), SELECTION.fetch_add(1, Ordering::Relaxed)));
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temp)
        .map_err(|error| format!("无法创建导出临时文件：{error}"))?;
    let result = (|| -> Result<(), String> {
        let mut input = fs::File::open(source).map_err(io_error)?;
        if input.metadata().map_err(io_error)?.len() != expected_size { return Err("源文件大小已变化".into()); }
        let copied = std::io::copy(&mut input, &mut output).map_err(io_error)?;
        if copied != expected_size || input.metadata().map_err(io_error)?.len() != expected_size { return Err("原始文件复制不完整或源文件已变化".into()); }
        output.sync_all().map_err(io_error)?;
        Ok(())
    })();
    drop(output);
    // 同目录硬链接仅在目标不存在时发布完整文件，避免覆盖已有文件或源文件本身。
    let result = result.and_then(|_| fs::hard_link(&temp, target).map_err(|error| format!("无法发布完整原始文件（不覆盖已有文件）：{error}")));
    let _ = fs::remove_file(&temp);
    result
}

#[tauri::command]
pub(super) async fn save_original_files(app: tauri::AppHandle, files: Vec<OriginalRequest>) -> Result<String, String> {
    if files.is_empty() { return Err("没有可导出的原始实例".into()); }
    let sources = {
        let state = app.state::<AuthorizedOriginals>();
        let originals = state.0.lock().map_err(|_| "原始文件授权表不可用")?;
        let mut seen = std::collections::HashSet::new();
        let mut sources = Vec::new();
        for file in files {
            let (path, size) = originals.get(&file.id).ok_or("当前来源不是已授权的原生文件；ZIP 展开项及预置样本暂不支持桌面原始导出")?;
            if *size != file.size { return Err("原始文件大小不一致，请重新导入".into()); }
            if seen.insert(file.id) { sources.push((path.clone(), *size)); }
        }
        sources
    };
    if sources.len() == 1 {
        let target = app.dialog().file().set_title("保存完整原始 DICOM（含原始身份标签）")
            .set_file_name("original-instance.dcm").blocking_save_file();
        let Some(target) = target else { return Ok("cancelled".into()); };
        let target = target.into_path().map_err(|_| "无法访问保存路径")?;
        copy_original(&sources[0].0, &target, sources[0].1)?;
    } else {
        let target = app.dialog().file().set_title("选择导出目录（创建新子目录，不覆盖已有文件）").blocking_pick_folder();
        let Some(target) = target else { return Ok("cancelled".into()); };
        let parent = target.into_path().map_err(|_| "无法访问保存路径")?;
        let folder = parent.join(format!("opendicomviewer-series-{}", SELECTION.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&folder).map_err(|error| format!("无法创建新的序列目录：{error}"))?;
        for (index, (source, size)) in sources.iter().enumerate() {
            if let Err(error) = copy_original(source, &folder.join(format!("instance-{:06}.dcm", index + 1)), *size) {
                // 此目录由本次 create_dir 独占创建，只清理本次部分导出。
                let _ = fs::remove_dir_all(&folder);
                return Err(error);
            }
        }
    }
    Ok("saved".into())
}

#[cfg(test)]
#[path = "original_export_tests.rs"]
mod tests;
