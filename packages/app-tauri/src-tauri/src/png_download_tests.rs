use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
static ID: AtomicU64 = AtomicU64::new(0);
fn task(bytes: &[u8]) -> DownloadTask {
    let root = std::env::temp_dir().join(format!("odv-png-test-{}-{}", std::process::id(), ID.fetch_add(1, Ordering::SeqCst)));
    fs::create_dir(&root).unwrap();
    let target = root.join("saved.png");
    let folder = staging_folder(&target, "test").unwrap();
    fs::write(folder.join("snapshot.png"), bytes).unwrap();
    DownloadTask { id: "test".into(), url: "blob:tauri://localhost/test".into(), size: bytes.len() as u64, target: Some(target), folder: Some(folder), started: true, cancelled: false }
}
fn remove(task: &DownloadTask) { let root = task.target.as_ref().unwrap().parent().unwrap(); fs::remove_dir_all(root).unwrap(); }
#[test]
fn only_local_bounded_png_requests_are_accepted() {
    let id = "12345678-1234-1234-1234-123456789abc";
    assert!(valid_request(id, "blob:tauri://localhost/uuid", 100));
    assert!(valid_request(id, "blob:http://tauri.localhost/uuid", 100));
    assert!(valid_request(id, "blob:https://tauri.localhost/uuid", 100));
    assert!(!valid_request(id, "https://example.com/patient", 100));
    assert!(!valid_request(id, "blob:https://other.test/uuid", 100));
    assert!(!valid_request(id, "blob:http://tauri.localhost.evil.test/uuid", 100));
    assert!(!valid_request("../file", "blob:tauri://localhost/uuid", 100));
    assert!(!valid_request(id, "blob:tauri://localhost/uuid", MAX_PNG_SIZE + 1));
}
#[test]
fn complete_png_publishes_identical_bytes_without_overwriting() {
    let bytes = b"\x89PNG\r\n\x1a\nretained-png-snapshot";
    let task = task(bytes);
    publish(&task).unwrap();
    assert_eq!(fs::read(task.target.as_ref().unwrap()).unwrap(), bytes);
    assert!(publish(&task).is_err());
    assert_eq!(fs::read(task.target.as_ref().unwrap()).unwrap(), bytes);
    cleanup(&task).unwrap();
    assert!(!task.folder.as_ref().unwrap().exists());
    remove(&task);
}
#[test]
fn invalid_or_incomplete_png_preserves_existing_target() {
    let mut task = task(b"not a png");
    assert!(publish(&task).is_err());
    assert!(!task.target.as_ref().unwrap().exists());
    fs::write(task.target.as_ref().unwrap(), b"keep").unwrap();
    task.size += 1;
    assert!(publish(&task).is_err());
    assert_eq!(fs::read(task.target.as_ref().unwrap()).unwrap(), b"keep");
    cleanup(&task).unwrap(); remove(&task);
}
#[test]
fn cancellation_releases_active_slot_and_late_finish_cannot_publish() {
    let task = task(b"\x89PNG\r\n\x1a\nlate-download");
    let target = task.target.clone().unwrap();
    let folder = task.folder.clone().unwrap();
    let mut pending = DownloadState { active: Some(task), abandoned: vec![] };
    cancel_task(&mut pending, "test").unwrap();
    assert!(pending.active.is_none());
    assert_eq!(pending.abandoned.len(), 1);
    let completed = finished_task(&mut pending, "blob:tauri://localhost/test").unwrap();
    assert!(completed.cancelled);
    finish(&completed, true).unwrap();
    assert!(!target.exists()); assert!(!folder.exists());
    assert!(finished_task(&mut pending, "blob:tauri://localhost/test").is_none());
    remove(&completed);
}
