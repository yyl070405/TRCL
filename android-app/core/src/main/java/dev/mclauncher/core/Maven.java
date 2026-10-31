package dev.mclauncher.core;

/** Maven 坐标 <-> 仓库路径。 */
public final class Maven {
    private Maven() {
    }

    public static String path(String name) {
        String ext = "jar";
        String n = name;
        int at = n.lastIndexOf('@');
        if (at >= 0) {
            ext = n.substring(at + 1);
            n = n.substring(0, at);
        }
        String[] parts = n.split(":");
        if (parts.length < 3) {
            throw new IllegalArgumentException("无法解析 Maven 坐标: " + name);
        }
        String group = parts[0].replace('.', '/');
        String artifact = parts[1];
        String version = parts[2];
        String classifier = parts.length > 3 ? "-" + parts[3] : "";
        return group + "/" + artifact + "/" + version + "/" + artifact + "-" + version + classifier + "." + ext;
    }
}
