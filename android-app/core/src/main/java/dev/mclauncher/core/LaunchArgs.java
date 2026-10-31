package dev.mclauncher.core;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 生成 java 命令行。纯函数，不启动进程，方便在 JVM 上测试。 */
public final class LaunchArgs {
    private LaunchArgs() {
    }

    public static final class Auth {
        public final String name;
        public final String uuid;
        public final String accessToken;
        public final String type;
        public final String xuid;

        public Auth(String name, String uuid, String accessToken, String type, String xuid) {
            this.name = name;
            this.uuid = uuid;
            this.accessToken = accessToken;
            this.type = type;
            this.xuid = xuid;
        }

        public static Auth offline(String name) {
            return new Auth(name, offlineUuid(name), "0", "legacy", "");
        }
    }

    public static List<String> build(VersionMeta version, Path gameDir, Path shared, String baseId,
                                     Auth auth, Path javaBin, int memoryMb, int width, int height) {
        Rules.Context ctx = Rules.Context.android();
        Path librariesDir = shared.resolve("libraries");
        Path assetsDir = shared.resolve("assets");
        Path nativesDir = gameDir.resolve("natives");
        Path clientJar = shared.resolve("versions").resolve(baseId).resolve(baseId + ".jar");

        List<String> classpathEntries = new ArrayList<String>();
        for (VersionMeta.Library lib : Libraries.dedupe(version.libraries, ctx)) {
            // 老式 natives 会解压到 natives 目录，不能进 classpath；
            // 1.19+ 的 classifier jar 必须留在 classpath 上。
            if (lib.natives != null) {
                continue;
            }
            classpathEntries.add(Libraries.artifactPath(lib, librariesDir).toString());
        }
        classpathEntries.add(clientJar.toString());
        String classpath = join(classpathEntries, ":");

        String assetIndex = version.assetIndex != null && version.assetIndex.id != null
                ? version.assetIndex.id
                : (version.assets != null ? version.assets : "legacy");

        Map<String, String> vars = new HashMap<String, String>();
        vars.put("auth_player_name", auth.name);
        vars.put("auth_uuid", auth.uuid);
        vars.put("auth_access_token", auth.accessToken);
        vars.put("auth_session", auth.accessToken);
        vars.put("auth_xuid", auth.xuid == null ? "" : auth.xuid);
        vars.put("clientid", "");
        vars.put("user_type", "msa".equals(auth.type) ? "msa" : "legacy");
        vars.put("user_properties", "{}");
        vars.put("version_name", version.id);
        vars.put("version_type", version.type == null ? "release" : version.type);
        vars.put("game_directory", gameDir.toString());
        vars.put("game_assets", assetsDir.resolve("virtual").resolve("legacy").toString());
        vars.put("assets_root", assetsDir.toString());
        vars.put("assets_index_name", assetIndex);
        vars.put("natives_directory", nativesDir.toString());
        vars.put("launcher_name", "MCLauncher");
        vars.put("launcher_version", "0.1.0");
        vars.put("classpath", classpath);
        vars.put("classpath_separator", ":");
        vars.put("library_directory", librariesDir.toString());
        vars.put("resolution_width", String.valueOf(width));
        vars.put("resolution_height", String.valueOf(height));
        vars.put("path", "");
        vars.put("quickPlayPath", "");
        vars.put("quickPlaySingleplayer", "");
        vars.put("quickPlayMultiplayer", "");
        vars.put("quickPlayRealms", "");

        List<String> jvm = new ArrayList<String>();
        jvm.add("-Xmx" + memoryMb + "M");
        if (version.arguments != null && version.arguments.jvm != null && !version.arguments.jvm.isEmpty()) {
            jvm.addAll(flatten(version.arguments.jvm, ctx));
        } else {
            jvm.add("-Djava.library.path=" + nativesDir);
            jvm.add("-cp");
            jvm.add(classpath);
        }

        List<String> game = version.arguments != null && version.arguments.game != null
                ? flatten(version.arguments.game, ctx)
                : tokenize(version.minecraftArguments);

        List<String> command = new ArrayList<String>();
        command.add(javaBin.toString());
        for (String arg : jvm) {
            command.add(substitute(arg, vars));
        }
        command.add(version.mainClass);
        for (String arg : game) {
            command.add(substitute(arg, vars));
        }
        return command;
    }

    static List<String> flatten(List<Object> items, Rules.Context ctx) {
        List<String> out = new ArrayList<String>();
        for (Object item : items) {
            if (item instanceof String) {
                out.add((String) item);
            } else if (item instanceof Map) {
                Map<?, ?> map = (Map<?, ?>) item;
                List<Rules.Rule> rules = Json.rules(map.get("rules"));
                if (rules != null && !Rules.matches(rules, ctx)) {
                    continue;
                }
                Object value = map.get("value");
                if (value instanceof String) {
                    out.add((String) value);
                } else if (value instanceof List) {
                    for (Object v : (List<?>) value) {
                        if (v instanceof String) {
                            out.add((String) v);
                        }
                    }
                }
            }
        }
        return out;
    }

    static List<String> tokenize(String str) {
        List<String> out = new ArrayList<String>();
        if (str == null) {
            return out;
        }
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < str.length(); i++) {
            char c = str.charAt(i);
            if (c == '"') {
                quoted = !quoted;
            } else if (!quoted && Character.isWhitespace(c)) {
                if (cur.length() > 0) {
                    out.add(cur.toString());
                    cur.setLength(0);
                }
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) {
            out.add(cur.toString());
        }
        return out;
    }

    static String substitute(String value, Map<String, String> vars) {
        String result = value;
        for (Map.Entry<String, String> e : vars.entrySet()) {
            result = result.replace("${" + e.getKey() + "}", e.getValue());
        }
        return result;
    }

    static String join(List<String> items, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) {
                sb.append(sep);
            }
            sb.append(items.get(i));
        }
        return sb.toString();
    }

    /** 离线 UUID：md5("OfflinePlayer:<name>")，与官方启动器一致。 */
    public static String offlineUuid(String name) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] hash = md.digest(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
            hash[6] = (byte) ((hash[6] & 0x0f) | 0x30);
            hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            String hex = sb.toString();
            return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16)
                    + "-" + hex.substring(16, 20) + "-" + hex.substring(20);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
