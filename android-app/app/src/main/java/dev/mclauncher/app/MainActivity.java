package dev.mclauncher.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import dev.mclauncher.core.AccountStore;
import dev.mclauncher.core.Assets;
import dev.mclauncher.core.Downloader;
import dev.mclauncher.core.Installer;
import dev.mclauncher.core.Meta;
import dev.mclauncher.core.MicrosoftAuth;
import dev.mclauncher.core.Rules;
import dev.mclauncher.core.Verifier;
import dev.mclauncher.core.VersionMeta;

/**
 * 第二阶段：拉清单 -> 下版本 JSON -> 自动补全（client/libraries/assets）-> 微软登录。
 * 启动游戏还缺 JRE / LWJGL / GL 转译，见 android-app/README.md。
 */
public class MainActivity extends Activity {
    /** 填 Azure 应用（移动和桌面应用）的客户端 ID 后，微软登录才可用。 */
    private static final String MS_CLIENT_ID = "";

    private TextView log;
    private Meta.Manifest manifest;
    private Path shared;
    private Path accountsFile;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        shared = new File(getFilesDir(), "shared").toPath();
        accountsFile = new File(getFilesDir(), "accounts.json").toPath();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        Button listButton = new Button(this);
        listButton.setText("获取版本列表");
        listButton.setOnClickListener(v -> fetchManifest());

        Button installButton = new Button(this);
        installButton.setText("补全 1.21.4（只下缺失文件）");
        installButton.setOnClickListener(v -> install("1.21.4"));

        Button loginButton = new Button(this);
        loginButton.setText("微软登录");
        loginButton.setOnClickListener(v -> login());

        log = new TextView(this);
        log.setTextSize(11);
        log.setTextIsSelectable(true);
        log.setPadding(0, pad, 0, 0);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(log, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(listButton);
        root.addView(installButton);
        root.addView(loginButton);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        append("数据目录: " + shared);
    }

    private void append(final String line) {
        runOnUiThread(() -> log.append(line + "\n"));
    }

    private void fetchManifest() {
        new Thread(() -> {
            try {
                append("拉取版本清单…");
                manifest = Meta.manifest();
                append("最新正式版: " + manifest.latest.release + "，快照: " + manifest.latest.snapshot);
                append("共 " + manifest.versions.size() + " 个版本");
            } catch (Exception e) {
                append("失败: " + e.getMessage());
            }
        }).start();
    }

    private void install(final String id) {
        new Thread(() -> {
            try {
                Path versionsDir = shared.resolve("versions");
                Path assetsDir = shared.resolve("assets");
                Files.createDirectories(versionsDir);
                Files.createDirectories(shared.resolve("libraries"));
                Files.createDirectories(assetsDir);

                if (manifest == null) {
                    manifest = Meta.manifest();
                }
                Meta.Entry entry = Meta.find(manifest, id);
                if (entry == null) {
                    append("清单里没有 " + id);
                    return;
                }

                append("获取 " + id + " 的版本 JSON…");
                VersionMeta version = Meta.version(versionsDir, id, entry.url);

                Downloader downloader = new Downloader();
                List<Installer.Task> versionTasks = Installer.plan(version, version, id, shared, Rules.Context.android());

                // 资源索引必须先拿到，才能知道 objects 列表
                Installer.Task indexTask = Assets.indexTask(version.assetIndex, assetsDir);
                List<Installer.Task> assetTasks = new ArrayList<Installer.Task>();
                if (indexTask != null) {
                    if (!Verifier.missing(Collections.singletonList(indexTask), true).isEmpty()) {
                        append("下载资源索引…");
                        downloader.download(indexTask);
                    }
                    Assets.Index index = Assets.load(java.nio.file.Paths.get(indexTask.dest));
                    assetTasks = Assets.plan(index, assetsDir);
                }

                List<Installer.Task> missingVersion = Verifier.missing(versionTasks, true);
                List<Installer.Task> missingAssets = Verifier.missing(assetTasks, false);
                append("缺失 " + missingVersion.size() + " 个版本文件，" + missingAssets.size() + " 个资源文件");

                List<Installer.Task> all = new ArrayList<Installer.Task>();
                all.addAll(missingVersion);
                all.addAll(missingAssets);
                if (all.isEmpty()) {
                    append("文件已完整，无需补全");
                    return;
                }

                List<Installer.Task> failed = downloader.downloadAll(all, 8, (done, total, label) -> {
                    if (done % 20 == 0 || done == total) {
                        append("下载 " + done + "/" + total + " " + label);
                    }
                });
                append(failed.isEmpty() ? "补全完成" : "失败 " + failed.size() + " 个文件，可再点一次重试");
            } catch (Exception e) {
                append("失败: " + e);
            }
        }).start();
    }

    private void login() {
        new Thread(() -> {
            try {
                if (MS_CLIENT_ID.isEmpty()) {
                    append("未配置微软 client id：在 MainActivity 里填 MS_CLIENT_ID");
                    return;
                }
                MicrosoftAuth auth = new MicrosoftAuth(MS_CLIENT_ID);
                MicrosoftAuth.DeviceCode code = auth.start();
                append("浏览器打开 " + code.verificationUri + "，输入代码 " + code.userCode);
                long deadline = System.currentTimeMillis() + code.expiresIn * 1000L;
                int interval = code.interval;
                while (System.currentTimeMillis() < deadline) {
                    Thread.sleep(Math.max(1, interval) * 1000L);
                    MicrosoftAuth.PollResult result = auth.poll(code);
                    if (result.pending) {
                        if (result.slowDown) {
                            interval += 2;
                        }
                        continue;
                    }
                    append("授权成功，换取 Minecraft 账号…");
                    MicrosoftAuth.Account account = auth.complete(result.tokens);
                    AccountStore store = new AccountStore(accountsFile);
                    store.load();
                    store.add(account);
                    store.save();
                    append("登录成功: " + account.name + " (" + account.uuid + ")");
                    return;
                }
                append("设备码已过期，请重试");
            } catch (Exception e) {
                append("登录失败: " + e.getMessage());
            }
        }).start();
    }
}
