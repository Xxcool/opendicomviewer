use serde::Deserialize;
use std::{fs::File, io::Read};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadFormat { Png, Dicom, Zip, Sr, Gsps, Results }

impl DownloadFormat {
    pub fn valid_size(self, size: u64) -> bool {
        match self {
            Self::Png => (45..=100 * 1024 * 1024).contains(&size),
            Self::Sr | Self::Gsps => (132..=10 * 1024 * 1024).contains(&size),
            Self::Dicom => (1..=512 * 1024 * 1024).contains(&size),
            Self::Zip | Self::Results => (22..=512 * 1024 * 1024).contains(&size),
        }
    }
    pub fn extension(self) -> &'static str {
        match self { Self::Png => "png", Self::Dicom | Self::Sr | Self::Gsps => "dcm", Self::Zip | Self::Results => "zip" }
    }
    pub fn label(self) -> &'static str {
        match self { Self::Png => "PNG", Self::Dicom | Self::Sr | Self::Gsps => "DICOM", Self::Zip | Self::Results => "ZIP" }
    }
    pub fn filename(self) -> &'static str {
        match self { Self::Png => "opendicomviewer.png", Self::Sr => "distance-report.dcm", Self::Gsps => "presentation-state.dcm", Self::Dicom => "original-instance.dcm", Self::Results => "frame-results.zip", Self::Zip => "original-series.zip" }
    }
    pub fn validate(self, file: &mut File) -> Result<(), String> {
        // 原始 DICOM 作为不透明实例复制；Rust 不重新解析标签，也不强制所有实例带 Part 10 前导。
        if matches!(self, Self::Sr | Self::Gsps) {
            let mut header = [0; 132];
            file.read_exact(&mut header).map_err(|_| "DICOM 结果文件不完整")?;
            return if &header[128..] == b"DICM" { Ok(()) } else { Err("结果文件缺少 DICOM 标识".into()) };
        }
        let signature: &[u8] = match self { Self::Png => b"\x89PNG\r\n\x1a\n", Self::Zip | Self::Results => b"PK\x03\x04", Self::Dicom | Self::Sr | Self::Gsps => return Ok(()) };
        let mut actual = vec![0; signature.len()];
        file.read_exact(&mut actual).map_err(|_| "导出文件不完整")?;
        if actual != signature { return Err("导出文件格式不一致，未写入目标文件".into()); }
        Ok(())
    }
}
