use serde::Deserialize;
use std::{fs::File, io::Read};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadFormat { Png, Dicom, Zip }

impl DownloadFormat {
    pub fn valid_size(self, size: u64) -> bool {
        match self {
            Self::Png => (45..=100 * 1024 * 1024).contains(&size),
            Self::Dicom => (1..=512 * 1024 * 1024).contains(&size),
            Self::Zip => (22..=512 * 1024 * 1024).contains(&size),
        }
    }
    pub fn extension(self) -> &'static str {
        match self { Self::Png => "png", Self::Dicom => "dcm", Self::Zip => "zip" }
    }
    pub fn label(self) -> &'static str {
        match self { Self::Png => "PNG", Self::Dicom => "DICOM", Self::Zip => "ZIP" }
    }
    pub fn filename(self) -> &'static str {
        match self { Self::Png => "opendicomviewer.png", Self::Dicom => "original-instance.dcm", Self::Zip => "original-series.zip" }
    }
    pub fn validate(self, file: &mut File) -> Result<(), String> {
        // 原始 DICOM 作为不透明实例复制；Rust 不重新解析标签，也不强制所有实例带 Part 10 前导。
        let signature: &[u8] = match self { Self::Png => b"\x89PNG\r\n\x1a\n", Self::Zip => b"PK\x03\x04", Self::Dicom => return Ok(()) };
        let mut actual = vec![0; signature.len()];
        file.read_exact(&mut actual).map_err(|_| "导出文件不完整")?;
        if actual != signature { return Err("导出文件格式不一致，未写入目标文件".into()); }
        Ok(())
    }
}
