//! 保存用户最近打开的文件，30 天后移除记录及文件内容。
use anyhow::{Context, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tokio::sync::OnceCell;
use topcoat::{
    Result,
    context::Cx,
    router::{content::Json, request::headers, route},
};

const MAX_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: i64 = 256 * 1024 * 1024;
static POOL: OnceCell<PgPool> = OnceCell::const_new();

#[derive(Deserialize)]
struct HostConfig {
    database_url: String,
    tenant_id: String,
}

async fn pool() -> anyhow::Result<&'static PgPool> {
    POOL.get_or_try_init(|| async {
        let url = match std::env::var_os("AIO_PLUGIN_CONFIG") {
            Some(path) => serde_json::from_slice::<HostConfig>(&std::fs::read(path)?)?.database_url,
            None => std::env::var("AIO_PREVIEW_DATABASE_URL").context("未配置历史数据库")?,
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&url)
            .await?;
        Ok(pool)
    })
    .await
}

fn owner(cx: &Cx) -> anyhow::Result<(String, String)> {
    let headers = headers(cx);
    let tenant = super::header(headers, "x-aio-tenant-id");
    let user = super::header(headers, "x-aio-user-id");
    ensure!(
        !tenant.is_empty() && !user.is_empty(),
        "缺少历史记录调用身份"
    );
    if let Some(path) = std::env::var_os("AIO_PLUGIN_CONFIG") {
        let config: HostConfig = serde_json::from_slice(&std::fs::read(path)?)?;
        ensure!(tenant == config.tenant_id, "租户身份不匹配");
    }
    Ok((tenant, user))
}

pub async fn prune() -> anyhow::Result<()> {
    sqlx::query("DELETE FROM preview_history WHERE opened_at <= now() - interval '30 days'")
        .execute(pool().await?)
        .await?;
    Ok(())
}

#[derive(Serialize)]
struct Entry {
    id: String,
    name: String,
    mime: String,
    size: i64,
    opened_at: i64,
}

#[derive(Deserialize)]
struct Save {
    name: String,
    mime: String,
    content: String,
}

#[derive(Deserialize)]
struct Selection {
    id: String,
}

#[route(GET "/api/history")]
async fn list(cx: &Cx) -> Result<Json<Vec<Entry>>> {
    let (tenant, user) = owner(cx)?;
    prune().await?;
    let rows = sqlx::query("SELECT id,name,mime,octet_length(content)::bigint AS size,(extract(epoch from opened_at)*1000)::bigint AS opened_at FROM preview_history WHERE tenant_id=$1 AND user_id=$2 ORDER BY opened_at DESC LIMIT 100")
        .bind(tenant).bind(user).fetch_all(pool().await?).await?;
    let entries = rows
        .iter()
        .map(|row| -> anyhow::Result<Entry> {
            Ok(Entry {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                mime: row.try_get("mime")?,
                size: row.try_get("size")?,
                opened_at: row.try_get("opened_at")?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(Json(entries))
}

fn validate_save(input: &Save) -> anyhow::Result<Vec<u8>> {
    ensure!(
        !input.name.is_empty() && input.name.len() <= 1024 && input.mime.len() <= 200,
        "文件信息无效"
    );
    ensure!(
        input.content.len() <= (MAX_FILE_BYTES + 2) / 3 * 4,
        "历史文件超过 4 MiB 上限"
    );
    let bytes = STANDARD.decode(&input.content)?;
    ensure!(bytes.len() <= MAX_FILE_BYTES, "历史文件超过 4 MiB 上限");
    Ok(bytes)
}

#[route(POST "/api/history")]
async fn save(cx: &Cx, Json(input): Json<Save>) -> Result<Json<serde_json::Value>> {
    let (tenant, user) = owner(cx)?;
    let bytes = validate_save(&input)?;
    let mut hash = Sha256::new();
    hash.update(input.name.as_bytes());
    hash.update([0]);
    hash.update(&bytes);
    let id = format!("{:x}", hash.finalize());
    let mut transaction = pool().await?.begin().await?;
    // 同一个用户的并发保存串行处理，避免超过历史空间上限。
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{tenant}:{user}"))
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM preview_history WHERE tenant_id=$1 AND user_id=$2 AND opened_at <= now() - interval '30 days'").bind(&tenant).bind(&user).execute(&mut *transaction).await?;
    sqlx::query("INSERT INTO preview_history(tenant_id,user_id,id,name,mime,content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,user_id,id) DO UPDATE SET opened_at=clock_timestamp()")
        .bind(&tenant).bind(&user).bind(&id).bind(input.name).bind(input.mime).bind(bytes).execute(&mut *transaction).await?;
    sqlx::query("DELETE FROM preview_history WHERE tenant_id=$1 AND user_id=$2 AND id IN (SELECT id FROM (SELECT id,row_number() OVER (ORDER BY opened_at DESC,id) AS position,sum(octet_length(content)) OVER (ORDER BY opened_at DESC,id) AS total FROM preview_history WHERE tenant_id=$1 AND user_id=$2) ranked WHERE position>100 OR total>$3)")
        .bind(tenant).bind(user).bind(MAX_TOTAL_BYTES).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(serde_json::json!({"id":id})))
}

#[route(POST "/api/history/open")]
async fn open(cx: &Cx, Json(input): Json<Selection>) -> Result<Json<serde_json::Value>> {
    let (tenant, user) = owner(cx)?;
    let row = sqlx::query("SELECT name,mime,content FROM preview_history WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND opened_at>now()-interval '30 days'")
        .bind(tenant).bind(user).bind(input.id).fetch_optional(pool().await?).await?.context("历史文件不存在或已过期")?;
    let bytes: Vec<u8> = row.try_get("content")?;
    Ok(Json(
        serde_json::json!({"name": row.try_get::<String,_>("name")?, "mime":row.try_get::<String,_>("mime")?, "content":STANDARD.encode(bytes)}),
    ))
}

#[route(DELETE "/api/history")]
async fn remove(cx: &Cx, Json(input): Json<Selection>) -> Result<Json<serde_json::Value>> {
    let (tenant, user) = owner(cx)?;
    sqlx::query("DELETE FROM preview_history WHERE tenant_id=$1 AND user_id=$2 AND id=$3")
        .bind(tenant)
        .bind(user)
        .bind(input.id)
        .execute(pool().await?)
        .await?;
    Ok(Json(serde_json::json!({"deleted":true})))
}

#[route(DELETE "/api/history/all")]
async fn clear(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let (tenant, user) = owner(cx)?;
    sqlx::query("DELETE FROM preview_history WHERE tenant_id=$1 AND user_id=$2")
        .bind(tenant)
        .bind(user)
        .execute(pool().await?)
        .await?;
    Ok(Json(serde_json::json!({"deleted":true})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "需要 AIO_PREVIEW_DATABASE_URL 指向独立历史测试数据库"]
    async fn history_retention_deduplication_and_user_isolation() -> anyhow::Result<()> {
        let pool = pool().await?;
        sqlx::raw_sql(include_str!("../migrations/001_preview_history.sql"))
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO preview_history(tenant_id,user_id,id,name,mime,content,opened_at) VALUES ('test','one','expired','expired.md','text/markdown',$1,now()-interval '30 days'),('test','one','live','live.md','text/markdown',$1,now()-interval '29 days'),('test','two','private','private.md','text/markdown',$1,now())")
            .bind(b"# history".to_vec()).execute(pool).await?;
        use topcoat::router::{Body, Method, StatusCode, request::Request, to_bytes};
        async fn call(
            user: &str,
            method: Method,
            path: &str,
            body: serde_json::Value,
        ) -> anyhow::Result<(StatusCode, serde_json::Value)> {
            let request = Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .header("x-aio-tenant-id", "test")
                .header("x-aio-user-id", user)
                .body(Body::from(body.to_string()))?;
            let response = crate::router().handle(request).await;
            let status = response.status();
            let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            Ok((
                status,
                serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                    serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
                }),
            ))
        }
        let payload = serde_json::json!({"name":"api.md","mime":"text/markdown","content":STANDARD.encode(b"# API history")});
        let (status, saved) = call("one", Method::POST, "/api/history", payload.clone()).await?;
        assert_eq!(status, StatusCode::OK);
        let (_, again) = call("one", Method::POST, "/api/history", payload).await?;
        assert_eq!(saved, again);
        let selection = serde_json::json!({"id":saved["id"]});
        let (status, reopened) =
            call("one", Method::POST, "/api/history/open", selection.clone()).await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(reopened["content"], STANDARD.encode(b"# API history"));
        let (status, _) = call("two", Method::POST, "/api/history/open", selection.clone()).await?;
        assert_ne!(status, StatusCode::OK);
        call("two", Method::DELETE, "/api/history", selection.clone()).await?;
        let (status, _) = call("one", Method::POST, "/api/history/open", selection.clone()).await?;
        assert_eq!(status, StatusCode::OK);
        call("one", Method::DELETE, "/api/history", selection.clone()).await?;
        let (status, _) = call("one", Method::POST, "/api/history/open", selection).await?;
        assert_ne!(status, StatusCode::OK);
        prune().await?;
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM preview_history WHERE id='expired'")
                .fetch_one(pool)
                .await?;
        assert_eq!(count, 0);
        let names: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM preview_history WHERE tenant_id='test' AND user_id='one'",
        )
        .fetch_all(pool)
        .await?;
        assert_eq!(names, vec!["live.md"]);
        let private: Option<Vec<u8>> = sqlx::query_scalar("SELECT content FROM preview_history WHERE tenant_id='test' AND user_id='one' AND id='private'").fetch_optional(pool).await?;
        assert!(private.is_none());
        call(
            "one",
            Method::DELETE,
            "/api/history/all",
            serde_json::Value::Null,
        )
        .await?;
        let (_, remaining) =
            call("two", Method::GET, "/api/history", serde_json::Value::Null).await?;
        assert_eq!(remaining.as_array().map(Vec::len), Some(1));
        sqlx::query("DELETE FROM preview_history WHERE tenant_id='test'")
            .execute(pool)
            .await?;
        Ok(())
    }
}
