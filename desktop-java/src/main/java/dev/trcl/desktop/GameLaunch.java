package dev.trcl.desktop;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.mclauncher.core.LaunchArgs;
import dev.mclauncher.core.Rules;
import dev.mclauncher.core.VersionMeta;
import dev.mclauncher.core.Json;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * 直接起 java 进程跑游戏：读实例与版本 JSON、拼命令行、把输出转给界面。
 * 没有本地 HTTP 服务，也没有 Node —— 整个启动路径都在这个 JVM 里。
 */
public final class GameLaunch {

    private final Path home;

    public GameLaunch(Path home) {
        this.home = home;
    }

    /** 实例目录列表（<data>/instances/*）。 */
    public List<Path> listInstances() throws IOException {
        Path dir = home.resolve("instances");
        List<Path> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path p : stream) {
                if (Files.isRegularFile(p.resolve("instance.json"))) out.add(p);
            }
        }
        out.sort((a, b) -> a.getFileName().toString().compareTo(b.getFileName().toString()));
        return out;
    }

    /** 起进程，日志按行回调；返回 Process 供界面停止。 */
    public Process launch(Path instanceDir, Consumer<String> onLine) throws IOException {
        JsonObject instance = Json.readJson(instanceDir.resolve("instance.json"));
        String versionId = string(instance, "versionId", string(instance, "mcVersion", null));
        if (versionId == null) throw new IOException("实例缺少 versionId");

        Path shared = home.resolve("shared");
        Path versionsDir = shared.resolve("versions");
        JsonObject version = loadMerged(versionsDir, versionId);
        String rootId = rootVersionId(versionsDir, versionId);

        VersionMeta meta = Json.GSON.fromJson(version, VersionMeta.class);
        int memory = intOf(instance, "memoryMb", 2048);
        int width = intOf(instance, "width", 854);
        int height = intOf(instance, "height", 480);

        Rules.Context ctx = desktopContext(width, height);
        String sep = isWindows() ? ";" : ":";
        Path javaBin = findJava();

        LaunchArgs.Auth auth = LaunchArgs.Auth.offline("Steve");
        List<String> command = LaunchArgs.build(
                meta, instanceDir, shared, rootId, auth, javaBin, memory, width, height, ctx, sep);
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(instanceDir.toFile());
        pb.redirectErrorStream(true);
        Process process = pb.start();
        Thread pump = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) onLine.accept(line);
            } catch (IOException e) {
                onLine.accept("[launcher] 读日志失败: " + e.getMessage());
            }
        }, "trcl-log");
        pump.setDaemon(true);
        pump.start();
        return process;
    }

    /* ---------------- 版本 JSON ---------------- */

    JsonObject loadMerged(Path versionsDir, String id) throws IOException {
        JsonObject child = Json.readJson(versionsDir.resolve(id).resolve(id + ".json"));
        String parentId = string(child, "inheritsFrom", null);
        if (parentId == null) return child;
        JsonObject parent = loadMerged(versionsDir, parentId);
        JsonObject merged = parent.deepCopy();
        for (Map.Entry<String, JsonElement> e : child.entrySet()) {
            String key = e.getKey();
            if ("libraries".equals(key) && merged.has("libraries")) {
                JsonArray list = new JsonArray();
                for (JsonElement x : e.getValue().getAsJsonArray()) list.add(x);
                for (JsonElement x : merged.getAsJsonArray("libraries")) list.add(x);
                merged.add("libraries", list);
            } else if ("arguments".equals(key) && merged.has("arguments")) {
                merged.add("arguments", mergeArguments(merged.getAsJsonObject("arguments"), e.getValue().getAsJsonObject()));
            } else {
                merged.add(key, e.getValue());
            }
        }
        return merged;
    }

    JsonObject mergeArguments(JsonObject parent, JsonObject child) {
        JsonObject out = parent.deepCopy();
        for (String kind : new String[]{"game", "jvm"}) {
            if (!child.has(kind)) continue;
            JsonArray list = new JsonArray();
            for (JsonElement x : child.getAsJsonArray(kind)) list.add(x);
            if (out.has(kind)) for (JsonElement x : out.getAsJsonArray(kind)) list.add(x);
            out.add(kind, list);
        }
        return out;
    }

    String rootVersionId(Path versionsDir, String id) throws IOException {
        JsonObject child = Json.readJson(versionsDir.resolve(id).resolve(id + ".json"));
        String parent = string(child, "inheritsFrom", null);
        return parent == null ? id : rootVersionId(versionsDir, parent);
    }

    /* ---------------- 环境 ---------------- */

    static Rules.Context desktopContext(int width, int height) {
        String os = System.getProperty("os.name", "").toLowerCase();
        String osName = os.contains("win") ? "windows" : os.contains("mac") ? "osx" : "linux";
        String arch = System.getProperty("os.arch", "");
        String osArch = arch.contains("aarch64") || arch.contains("arm64") ? "arm64" : "x86_64";
        Map<String, Boolean> features = new HashMap<>();
        features.put("has_custom_resolution", width > 0 && height > 0);
        features.put("is_demo_user", false);
        features.put("has_quick_plays_support", false);
        return new Rules.Context(osName, osArch, System.getProperty("os.version", ""), features);
    }

    Path findJava() throws IOException {
        String bin = isWindows() ? "java.exe" : "java";
        String javaHome = System.getenv("JAVA_HOME");
        if (javaHome != null && !javaHome.isBlank()) {
            Path candidate = Path.of(javaHome, "bin", bin);
            if (Files.isRegularFile(candidate)) return candidate;
        }
        Path runtime = home.resolve("runtime");
        if (Files.isDirectory(runtime)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(runtime)) {
                for (Path p : stream) {
                    Path candidate = p.resolve("bin").resolve(bin);
                    if (Files.isRegularFile(candidate)) return candidate;
                }
            }
        }
        return Path.of(System.getProperty("java.home"), "bin", bin);
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    static String string(JsonObject obj, String key, String fallback) {
        JsonElement e = obj.get(key);
        return e == null || e.isJsonNull() ? fallback : e.getAsString();
    }

    static int intOf(JsonObject obj, String key, int fallback) {
        JsonElement e = obj.get(key);
        try {
            return e == null || e.isJsonNull() ? fallback : e.getAsInt();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }
}
