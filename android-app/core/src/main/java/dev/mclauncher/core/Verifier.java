package dev.mclauncher.core;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** 完整性检查：找出缺失或损坏的文件，交给 Downloader 补全。 */
public final class Verifier {
    private Verifier() {
    }

    public static List<Installer.Task> missing(List<Installer.Task> tasks, boolean checkSha1) throws IOException {
        List<Installer.Task> out = new ArrayList<Installer.Task>();
        for (Installer.Task task : tasks) {
            File file = new File(task.dest);
            if (!file.isFile()) {
                out.add(task);
                continue;
            }
            if (task.size > 0 && file.length() != task.size) {
                out.add(task);
                continue;
            }
            if (checkSha1 && task.sha1 != null && !task.sha1.equalsIgnoreCase(Downloader.sha1(file.toPath()))) {
                out.add(task);
            }
        }
        return out;
    }
}
