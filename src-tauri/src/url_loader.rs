//! Downloads run in the host: the editor's custom origin must not depend on
//! a remote server opting in to browser CORS.
use std::{collections::HashMap, time::Duration};

#[tauri::command]
pub async fn read_url_raw(
    url: String,
    request_headers: Option<HashMap<String, String>>,
) -> Result<tauri::ipc::Response, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only HTTP and HTTPS downloads are supported".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url);
    for (name, value) in request_headers.unwrap_or_default() {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    fn server(responses: Vec<&'static str>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/template.psd", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).unwrap();
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (url, thread)
    }

    #[test]
    fn follows_redirects_and_reads_bytes_without_cors_headers() {
        let (url, server) = server(vec![
            "HTTP/1.1 302 Found\r\nLocation: /download.psd\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n8BPS",
        ]);
        let response = tauri::async_runtime::block_on(read_url_raw(url, None)).unwrap();
        match response.body().unwrap() {
            InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, b"8BPS"),
            _ => panic!("download must use binary IPC"),
        }
        server.join().unwrap();
    }

    #[test]
    fn reports_http_errors_instead_of_parsing_the_error_page() {
        let (url, server) = server(vec![
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ]);
        let result = tauri::async_runtime::block_on(read_url_raw(url, None));
        assert!(matches!(result, Err(message) if message.contains("404")));
        server.join().unwrap();
    }

    #[test]
    fn rejects_non_http_download_schemes() {
        let result = tauri::async_runtime::block_on(read_url_raw("file:///tmp/a.psd".into(), None));
        assert!(matches!(result, Err(message) if message.contains("HTTP")));
    }
}
