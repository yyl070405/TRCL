package dev.mclauncher.core;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** 带 SHA1 校验、断点重下、并发控制的下载器（只用 HttpURLConnection，兼容 Android）。 */
public final class Downloader {
    public interface Listener {
        void onProgress(int done, int total, String label);
    }

    private static final String USER_AGENT = "TRCL/0.1 (+https://github.com/yyl070405/TRCL)";

    public void download(Installer.Task task) throws IOException {
        File dest = new File(task.dest);
        if (dest.isFile()) {
            if (task.size > 0 && dest.length() == task.size) {
                return;
            }
            if (task.sha1 != null && task.sha1.equalsIgnoreCase(sha1(dest.toPath()))) {
                return;
            }
        }
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("无法创建目录 " + parent);
        }
        File part = new File(task.dest + ".part");
        HttpURLConnection conn = (HttpURLConnection) new URL(task.url).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(120000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", USER_AGENT);
        int code = conn.getResponseCode();
        if (code != 200) {
            conn.disconnect();
            throw new IOException("HTTP " + code + " " + task.url);
        }
        InputStream in = new BufferedInputStream(conn.getInputStream(), 64 * 1024);
        OutputStream out = new FileOutputStream(part);
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } finally {
            try {
                out.close();
            } catch (IOException ignored) {
            }
            try {
                in.close();
            } catch (IOException ignored) {
            }
            conn.disconnect();
        }
        if (task.sha1 != null) {
            String got = sha1(part.toPath());
            if (!task.sha1.equalsIgnoreCase(got)) {
                part.delete();
                throw new IOException("SHA1 不匹配: " + task.url);
            }
        }
        try {
            Files.move(part.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            Files.move(part.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** 并发下载，返回失败列表（不抛异常，便于 UI 汇总）。 */
    public List<Installer.Task> downloadAll(final List<Installer.Task> tasks, int concurrency, final Listener listener) {
        final List<Installer.Task> failures = java.util.Collections.synchronizedList(new ArrayList<Installer.Task>());
        if (tasks.isEmpty()) {
            return failures;
        }
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, Math.min(concurrency, tasks.size())));
        List<Future<?>> futures = new ArrayList<Future<?>>();
        final java.util.concurrent.atomic.AtomicInteger done = new java.util.concurrent.atomic.AtomicInteger();
        for (final Installer.Task task : tasks) {
            futures.add(pool.submit(new Callable<Void>() {
                @Override
                public Void call() {
                    try {
                        download(task);
                    } catch (Exception e) {
                        failures.add(task);
                    } finally {
                        int n = done.incrementAndGet();
                        if (listener != null) {
                            listener.onProgress(n, tasks.size(), new File(task.dest).getName());
                        }
                    }
                    return null;
                }
            }));
        }
        for (Future<?> f : futures) {
            try {
                f.get();
            } catch (Exception ignored) {
            }
        }
        pool.shutdown();
        return failures;
    }

    public static String sha1(Path file) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            InputStream in = Files.newInputStream(file);
            byte[] buf = new byte[64 * 1024];
            int n;
            try {
                while ((n = in.read(buf)) > 0) {
                    md.update(buf, 0, n);
                }
            } finally {
                in.close();
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }
}
