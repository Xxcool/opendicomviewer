use super::*;
use std::path::PathBuf;

#[test]
fn original_copy_preserves_all_bytes_and_refuses_overwrite_and_size_change() {
    let root = folder();
    let source = root.join("source.dcm");
    let target = root.join("export.dcm");
    let bytes = [0, 255, 1, 2, 3, 0, 123];
    fs::write(&source, bytes).unwrap();
    copy_original(&source, &target, bytes.len() as u64).unwrap();
    assert_eq!(fs::read(&target).unwrap(), bytes);
    assert!(copy_original(&source, &source, bytes.len() as u64).is_err());
    assert!(copy_original(&source, &target, bytes.len() as u64).is_err());
    assert!(copy_original(&source, &root.join("changed.dcm"), 99).is_err());
    assert!(!root.join("changed.dcm").exists());
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    let occupied = root.join("occupied");
    fs::create_dir(&occupied).unwrap();
    assert!(copy_original(&source, &occupied, bytes.len() as u64).is_err());
    assert!(occupied.is_dir());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn original_copy_rejects_symlink_replacement() {
    let root = folder();
    let source = root.join("source.dcm");
    let actual = root.join("other.dcm");
    fs::write(&actual, [1, 2, 3]).unwrap();
    std::os::unix::fs::symlink(&actual, &source).unwrap();
    assert!(copy_original(&source, &root.join("export.dcm"), 3).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    fs::remove_dir_all(root).unwrap();
}

fn folder() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "odv-index-test-{}-{}",
        std::process::id(),
        SELECTION.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}
