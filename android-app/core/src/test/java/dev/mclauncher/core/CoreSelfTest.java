package dev.mclauncher.core;

import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 无依赖自检，直接 java -cp 运行；CI 里也可以用。 */
public final class CoreSelfTest {
    private static int failures = 0;

    private static void check(String name, boolean ok) {
        System.out.println((ok ? "PASS " : "FAIL ") + name);
        if (!ok) {
            failures++;
        }
    }

    public static void main(String[] args) throws Exception {
        check("maven path", Maven.path("org.lwjgl:lwjgl:3.3.3:natives-linux")
                .equals("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar"));

        Map<String, Boolean> noFeatures = new HashMap<String, Boolean>();
        Rules.Context windows = new Rules.Context("windows", "x86_64", "", noFeatures);
        Rules.Context linux = new Rules.Context("linux", "arm64", "Android", noFeatures);

        Rules.Rule allowWin = new Rules.Rule();
        allowWin.action = "allow";
        allowWin.os = new Rules.Os();
        allowWin.os.name = "windows";
        check("rules allow windows on windows", Rules.matches(Arrays.asList(allowWin), windows));
        check("rules reject windows on linux", !Rules.matches(Arrays.asList(allowWin), linux));

        VersionMeta version = new VersionMeta();
        version.id = "1.20.1";
        version.type = "release";
        version.mainClass = "net.minecraft.client.main.Main";
        version.assetIndex = new VersionMeta.AssetIndex();
        version.assetIndex.id = "5";
        version.libraries = new ArrayList<VersionMeta.Library>();
        version.libraries.add(library("org.ow2.asm:asm:9.6", "org/ow2/asm/asm/9.6/asm-9.6.jar"));
        version.libraries.add(library("org.ow2.asm:asm:9.10.1", "org/ow2/asm/asm/9.10.1/asm-9.10.1.jar"));
        VersionMeta.Library lwjgl = library("org.lwjgl:lwjgl:3.3.3", "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar");
        lwjgl.natives = new HashMap<String, String>();
        lwjgl.natives.put("linux", "natives-linux");
        version.libraries.add(lwjgl);

        version.arguments = new VersionMeta.Arguments();
        version.arguments.jvm = new ArrayList<Object>(
                Arrays.asList("-Djava.library.path=${natives_directory}", "-cp", "${classpath}"));
        version.arguments.game = new ArrayList<Object>(
                Arrays.asList("--username", "${auth_player_name}", "--uuid", "${auth_uuid}"));

        List<String> command = LaunchArgs.build(version, Paths.get("/game"), Paths.get("/shared"), "1.20.1",
                LaunchArgs.Auth.offline("Steve"), Paths.get("/jre/bin/java"), 4096, 854, 480);

        check("java first", "/jre/bin/java".equals(command.get(0)));
        check("memory flag", command.contains("-Xmx4096M"));
        int mainIdx = command.indexOf("net.minecraft.client.main.Main");
        int userIdx = command.indexOf("--username");
        check("mainClass before game args", mainIdx > 0 && userIdx > mainIdx);
        check("username substituted", "Steve".equals(command.get(userIdx + 1)));

        String classpath = command.get(command.indexOf("-cp") + 1);
        check("asm deduped", classpath.contains("asm-9.10.1.jar") && !classpath.contains("asm-9.6.jar"));
        check("client jar on classpath", classpath.endsWith("1.20.1.jar"));
        check("natives not on classpath", !classpath.contains("natives-linux"));

        check("offline uuid", LaunchArgs.offlineUuid("Steve")
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"));

        VersionMeta base = new VersionMeta();
        base.downloads = new VersionMeta.Downloads();
        base.downloads.client = new VersionMeta.Artifact();
        base.downloads.client.url = "https://example.invalid/client.jar";
        base.downloads.client.sha1 = "deadbeef";

        List<Installer.Task> plan = Installer.plan(version, base, "1.20.1", Paths.get("/shared"), linux);
        check("plan has client and libs", plan.size() >= 4);
        boolean hasNative = false;
        for (Installer.Task t : plan) {
            if ("native".equals(t.kind)) {
                hasNative = true;
            }
        }
        check("plan has native", hasNative);

        // 完整性检查：缺失文件会被识别
        java.nio.file.Path tmp = java.nio.file.Files.createTempDirectory("mc-core-test");
        java.nio.file.Path present = tmp.resolve("present.bin");
        java.nio.file.Files.write(present, "hello".getBytes("UTF-8"));
        List<Installer.Task> checkTasks = new ArrayList<Installer.Task>();
        checkTasks.add(new Installer.Task("https://example.invalid/a", present.toString(), null, 5, "library"));
        checkTasks.add(new Installer.Task("https://example.invalid/b", tmp.resolve("missing.bin").toString(), null, 10, "library"));
        java.nio.file.Files.write(tmp.resolve("wrong-size.bin"), "x".getBytes("UTF-8"));
        checkTasks.add(new Installer.Task("https://example.invalid/c", tmp.resolve("wrong-size.bin").toString(), null, 99, "library"));
        List<Installer.Task> missing = Verifier.missing(checkTasks, false);
        check("verifier finds missing and size mismatch", missing.size() == 2);

        // 资源索引解析
        String indexJson = "{\"objects\":{\"icons/icon.png\":{\"hash\":\"abcdef0123456789\",\"size\":1234}}}";
        java.nio.file.Path indexFile = tmp.resolve("assets.json");
        java.nio.file.Files.write(indexFile, indexJson.getBytes("UTF-8"));
        Assets.Index index = Assets.load(indexFile);
        List<Installer.Task> assetTasks = Assets.plan(index, tmp.resolve("assets"));
        check("asset plan", assetTasks.size() == 1 && assetTasks.get(0).dest.contains("ab/abcdef0123456789"));

        // 账号存储往返
        AccountStore store = new AccountStore(tmp.resolve("accounts.json"));
        store.load();
        MicrosoftAuth.Account account = new MicrosoftAuth.Account();
        account.name = "Steve";
        account.uuid = "uuid-1";
        account.accessToken = "token";
        store.add(account);
        store.save();
        AccountStore reloaded = new AccountStore(tmp.resolve("accounts.json"));
        reloaded.load();
        check("account store roundtrip", reloaded.current() != null && "Steve".equals(reloaded.current().name));

        // 未配置 client id 时给出明确错误
        boolean threw = false;
        try {
            new MicrosoftAuth("").start();
        } catch (IllegalStateException e) {
            threw = true;
        }
        check("microsoft requires client id", threw);
        check("xsts error mapping", MicrosoftAuth.xstsMessage("{\"XErr\":2148916233}").contains("Xbox 账号"));

        // 资源清单：可下载 + 手动兜底
        check("resource manifest", Resources.builtin().size() == 3);
        check("jre21 manual only", Resources.byId("jre21").manualOnly());
        check("mobileglues has url", !Resources.byId("mobileglues").manualOnly());
        check("manual help", Resources.manualHelp(Resources.byId("jre17")).contains("runtime/jre17"));
        boolean manualThrew = false;
        try {
            Resources.pickUrl(Resources.byId("jre21"));
        } catch (Exception e) {
            manualThrew = true;
        }
        check("manual component rejects auto download", manualThrew);

        String manifest = "{\"components\":[{\"id\":\"jre21\",\"name\":\"Java 21\",\"version\":\"21.0.5\","
                + "\"kind\":\"tar.xz\",\"sha256\":\"abc\",\"size\":123,\"urls\":[\"https://example.invalid/jre21.tar.xz\"]}]}";
        java.util.List<Resources.Component> parsed = Resources.parseManifest(manifest);
        check("remote manifest parse", parsed.size() == 1 && parsed.get(0).id.equals("jre21"));
        check("remote manifest url", parsed.get(0).urls.get(0).startsWith("https://"));
        check("remote manifest size", parsed.get(0).size == 123);

        // GitHub 直链会自动加加速前缀
        java.util.List<String> expanded = Resources.expandUrls(Resources.byId("mobileglues"));
        check("github proxy expansion", expanded.size() >= 2
                && expanded.get(0).startsWith("https://gh-proxy.com/https://github.com/"));
        check("direct url kept", expanded.contains(Resources.MOBILEGLUES_URL));

        System.out.println(failures == 0 ? "ALL OK" : failures + " FAILURES");
        if (failures > 0) {
            System.exit(1);
        }
    }

    private static VersionMeta.Library library(String name, String path) {
        VersionMeta.Library lib = new VersionMeta.Library();
        lib.name = name;
        lib.downloads = new VersionMeta.Downloads();
        lib.downloads.artifact = new VersionMeta.Artifact();
        lib.downloads.artifact.path = path;
        lib.downloads.artifact.url = "https://example.invalid/" + path;
        return lib;
    }
}
