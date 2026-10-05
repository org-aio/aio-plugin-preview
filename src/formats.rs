//! 支持的文件格式声明。
//!
//! 这张表是前后端唯一的格式事实来源：后端通过 `/api/formats` 暴露，
//! 前端用它决定渲染器与下拉列表，避免扩展名判断在两处漂移。

use serde::Serialize;

/// 单文件在浏览器内直接预览的上限（约 256 MiB）。
pub const MAX_INLINE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct Format {
    /// 渲染器标识，与前端 `viewers/` 中的注册名一致。
    pub renderer: &'static str,
    /// 分组，用于前端归类展示。
    pub category: &'static str,
    /// 人类可读名称。
    pub label: &'static str,
    /// 完整扩展名列表，均为小写且不含点。
    pub extensions: &'static [&'static str],
}

macro_rules! spec {
    ($renderer:literal, $category:literal, $label:literal, [$($extension:literal),* $(,)?]) => {
        Format {
            renderer: $renderer,
            category: $category,
            label: $label,
            extensions: &[$($extension),*],
        }
    };
}

pub fn all() -> Vec<Format> {
    vec![
        spec!("image", "image", "图片", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico", "tif", "tiff"]),
        spec!("pdf", "document", "PDF", ["pdf"]),
        spec!("video", "media", "视频", ["mp4", "webm", "ogv", "mov", "m4v"]),
        spec!("audio", "media", "音频", ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"]),
        spec!("text", "code", "文本与代码", ["txt", "log", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "conf", "env", "sh", "bash", "zsh", "ps1", "bat", "py", "rs", "go", "java", "kt", "kts", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "js", "jsx", "mjs", "cjs", "ts", "tsx", "vue", "svelte", "css", "scss", "less", "html", "htm", "sql", "gql", "graphql", "proto", "dockerfile", "makefile", "gradle", "lua", "swift", "dart", "scala", "r", "m", "pl", "vim"]),
        spec!("markdown", "document", "Markdown", ["md", "markdown", "mdx"]),
        spec!("docx", "document", "Word", ["docx"]),
        spec!("xlsx", "document", "表格", ["xlsx", "xls", "xlsm", "ods", "csvx"]),
        spec!("dwg", "cad", "CAD 图纸", ["dwg", "dxf"]),
        spec!("model", "model", "3D 模型", ["glb", "gltf", "obj", "stl", "ply", "fbx", "dae", "3ds", "3mf", "vtk", "pcd", "xyz"]),
        spec!("archive", "archive", "压缩包", ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]),
    ]
}

/// 按扩展名给出渲染器；未知格式回退到下载提示。
pub fn detect(filename: &str) -> &'static str {
    let Some(extension) = extension_of(filename) else {
        return "download";
    };
    all()
        .into_iter()
        .find(|format| format.extensions.contains(&extension.as_str()))
        .map_or("download", |format| format.renderer)
}

/// 取小写扩展名；无扩展名或点号结尾时返回 `None`。
fn extension_of(filename: &str) -> Option<String> {
    let name = filename.rsplit(['/', '\\']).next()?;
    let (_, extension) = name.rsplit_once('.')?;
    (!extension.is_empty()).then(|| extension.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_representative_extensions() {
        assert_eq!(detect("plan.DWG"), "dwg");
        assert_eq!(detect("site.dxf"), "dwg");
        assert_eq!(detect("a/b/c/robot.STL"), "model");
        assert_eq!(detect("report.pdf"), "pdf");
        assert_eq!(detect("data.xlsx"), "xlsx");
        assert_eq!(detect("readme.md"), "markdown");
        assert_eq!(detect("main.rs"), "text");
    }

    #[test]
    fn falls_back_when_extension_is_unknown_or_absent() {
        assert_eq!(detect("no-extension"), "download");
        assert_eq!(detect("trailing."), "download");
        assert_eq!(detect("mystery.bin-packed"), "download");
    }

    #[test]
    fn every_renderer_is_reachable_from_at_least_one_extension() {
        for format in all() {
            assert!(!format.extensions.is_empty(), "{} 没有扩展名", format.renderer);
            for extension in format.extensions {
                assert_eq!(detect(&format!("file.{extension}")), format.renderer);
            }
        }
    }

    #[test]
    fn extensions_are_lowercase_without_dots() {
        for format in all() {
            for extension in format.extensions {
                assert!(!extension.starts_with('.'), "扩展名不应带点: {extension}");
                assert_eq!(*extension, extension.to_ascii_lowercase());
            }
        }
    }
}
