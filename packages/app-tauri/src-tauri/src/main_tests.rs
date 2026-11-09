use super::*;
#[test]
fn annotation_write_replaces_complete_file() {
    let root = folder();
    let path = root.join("annotations.json");
    fs::write(&path, b"old").unwrap();
    write_annotations(&path, b"{\"records\":[]}").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"{\"records\":[]}");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn annotation_publish_failure_keeps_target_and_cleans_temp() {
    let root = folder();
    let path = root.join("occupied");
    fs::create_dir(&path).unwrap();
    fs::write(path.join("keep"), b"original").unwrap();
    assert!(write_annotations(&path, b"new").is_err());
    assert_eq!(fs::read(path.join("keep")).unwrap(), b"original");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
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
