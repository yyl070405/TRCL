package dev.mclauncher.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** 极简 HTTP 封装（GET / 表单 POST / JSON POST），兼容 Android。 */
public final class Http {
    private static final String USER_AGENT = "MCLauncher/0.1";

    private Http() {
    }

    public static String get(String url, Map<String, String> headers) throws IOException {
        return request("GET", url, null, headers);
    }

    public static String postForm(String url, Map<String, String> form) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : form.entrySet()) {
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(URLEncoder.encode(e.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8"));
        }
        return request("POST", url, sb.toString().getBytes(StandardCharsets.UTF_8), formHeaders());
    }

    public static String postJson(String url, String json, Map<String, String> headers) throws IOException {
        return request("POST", url, json.getBytes(StandardCharsets.UTF_8), jsonHeaders(headers));
    }

    private static Map<String, String> formHeaders() {
        java.util.HashMap<String, String> h = new java.util.HashMap<String, String>();
        h.put("Content-Type", "application/x-www-form-urlencoded");
        return h;
    }

    private static Map<String, String> jsonHeaders(Map<String, String> extra) {
        java.util.HashMap<String, String> h = new java.util.HashMap<String, String>();
        h.put("Content-Type", "application/json");
        if (extra != null) {
            h.putAll(extra);
        }
        return h;
    }

    private static String request(String method, String url, byte[] body, Map<String, String> headers) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestMethod(method);
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setRequestProperty("Accept", "application/json");
        if (headers != null) {
            for (Map.Entry<String, String> e : headers.entrySet()) {
                conn.setRequestProperty(e.getKey(), e.getValue());
            }
        }
        if (body != null) {
            conn.setDoOutput(true);
            OutputStream out = conn.getOutputStream();
            try {
                out.write(body);
            } finally {
                out.close();
            }
        }
        int code = conn.getResponseCode();
        InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = read(in);
        conn.disconnect();
        if (code >= 400) {
            throw new HttpException(code, text);
        }
        return text;
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) {
            return "";
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        try {
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } finally {
            in.close();
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    public static final class HttpException extends IOException {
        public final int status;
        public final String body;

        public HttpException(int status, String body) {
            super("HTTP " + status);
            this.status = status;
            this.body = body;
        }
    }
}
