//! AIO 文件预览插件的进程后端。
//!
//! 渲染全部在隔离前端的浏览器内完成；后端只提供运行时契约
//! （`/health`、`/aio/describe`）和一张供前端使用的格式能力表，
//! 保证前端与后端对“支持哪些格式”只有一处定义。

mod formats;

use std::env;

use serde::{Deserialize, Serialize};
use topcoat::{
    Result,
    context::Cx,
    router::{
        Router, RouterBuilderDiscoverExt,
        content::Json,
        request::headers,
        route,
    },
};

/// 宿主注入的调用身份，用于回显当前租户与用户。
#[derive(Serialize)]
struct RuntimeContext {
    tenant_id: String,
    user_id: String,
}

/// 前端在打开文件前先取一次格式表，避免把格式判断散落在多处。
#[derive(Serialize)]
struct Capabilities {
    formats: Vec<formats::Format>,
    max_inline_bytes: u64,
}

#[derive(Deserialize)]
struct RenderRequest {
    filename: String,
}

#[tokio::main]
async fn main() {
    if let Ok(port) = env::var("AIO_PLUGIN_PORT") {
        // Topcoat 读取 PORT；AIO 隔离进程只注入 AIO_PLUGIN_PORT。
        unsafe { env::set_var("PORT", port) };
    }
    if let Ok(path) = env::var("AIO_PLUGIN_SOCKET") {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = std::path::PathBuf::from(path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!("清理预览插件 socket 失败: {error}"),
            }
            let listener = tokio::net::UnixListener::bind(&path).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666)).unwrap();
            topcoat::serve(listener, router()).await.unwrap();
            return;
        }
        #[cfg(not(unix))]
        {
            let _ = path;
        }
    }
    topcoat::start(router()).await.unwrap();
}

fn router() -> Router {
    Router::builder().discover().build()
}

#[route(GET "/health")]
async fn health() -> Result<&'static str> {
    Ok("ok")
}

#[route(GET "/aio/describe")]
async fn describe() -> Result<Json<serde_json::Value>> {
    Ok(Json(serde_json::json!({
        "label": "文件预览",
        "pages": [{
            "id": "file-preview",
            "label": "文件预览",
            "entry": "index.html",
            "scene": ["workspace", "工作空间"],
            "menu_path": ["文件预览"],
            "permission": null,
            "surface": "workspace"
        }]
    })))
}

/// 格式能力表，前端与后端共用同一份声明。
#[route(GET "/api/formats")]
async fn capabilities() -> Result<Json<Capabilities>> {
    Ok(Json(Capabilities {
        formats: formats::all(),
        max_inline_bytes: formats::MAX_INLINE_BYTES,
    }))
}

/// 根据文件名给出推荐渲染器，前端在无法自行判定时回退到这里。
#[route(POST "/api/detect")]
async fn detect(Json(request): Json<RenderRequest>) -> Result<Json<serde_json::Value>> {
    Ok(Json(serde_json::json!({
        "filename": request.filename,
        "renderer": formats::detect(&request.filename),
    })))
}

#[route(GET "/api/context")]
async fn context(cx: &Cx) -> Result<Json<RuntimeContext>> {
    let headers = headers(cx);
    Ok(Json(RuntimeContext {
        tenant_id: header(headers, "x-aio-tenant-id"),
        user_id: header(headers, "x-aio-user-id"),
    }))
}

fn header(headers: &topcoat::router::HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use topcoat::router::{Body, Method, StatusCode, request::Request, to_bytes};

    async fn request(method: Method, path: &str, body: Body) -> (StatusCode, String) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .header("x-aio-tenant-id", "tenant-test")
            .header("x-aio-user-id", "user-test")
            .body(body)
            .unwrap();
        let response = router().handle(request).await;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn exposes_aio_runtime_contract() {
        let (status, body) = request(Method::GET, "/health", Body::empty()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "ok");

        let (status, body) = request(Method::GET, "/aio/describe", Body::empty()).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"id\":\"file-preview\""));
        assert!(body.contains("\"entry\":\"index.html\""));
    }

    #[tokio::test]
    async fn publishes_format_capabilities_and_detection() {
        let (status, body) = request(Method::GET, "/api/formats", Body::empty()).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"dwg\""));

        let (status, body) = request(
            Method::POST,
            "/api/detect",
            Body::from("{\"filename\":\"layer.dwg\"}"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"dwg\""));
    }

    #[tokio::test]
    async fn preserves_host_identity() {
        let (status, body) = request(Method::GET, "/api/context", Body::empty()).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("tenant-test"));
        assert!(body.contains("user-test"));
    }
}
