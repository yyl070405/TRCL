package dev.trcl.desktop;

import javax.swing.BorderFactory;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import javax.swing.WindowConstants;
import javax.swing.text.DefaultCaret;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * TRCL 桌面端：纯 Java + Swing，没有本地网页、没有 Node。
 * 启动时直接起 java 子进程跑游戏。
 */
public final class Main {

    static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final Path home;
    private final GameLaunch launcher;
    private final DefaultListModel<Path> model = new DefaultListModel<>();
    private final JList<Path> list = new JList<>(model);
    private final JTextArea log = new JTextArea();

    Main(Path home) {
        this.home = home;
        this.launcher = new GameLaunch(home);
    }

    public static void main(String[] args) throws Exception {
        Path home = resolveHome();
        Files.createDirectories(home);

        if (args.length > 1 && "--launch".equals(args[0])) {
            runHeadless(home, args[1]);
            return;
        }

        Main app = new Main(home);
        SwingUtilities.invokeLater(app::buildUi);
    }

    /** 无界面模式：给脚本和测试用，日志直接打到 stdout。 */
    static void runHeadless(Path home, String instance) throws Exception {
        GameLaunch launcher = new GameLaunch(home);
        Path dir = home.resolve("instances").resolve(instance);
        if (!Files.isDirectory(dir)) throw new IOException("实例不存在: " + dir);
        Process process = launcher.launch(dir, line -> System.out.println(line));
        System.exit(process.waitFor());
    }

    void buildUi() {
        JFrame frame = new JFrame("TRCL · Minecraft 启动器");
        frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        frame.setMinimumSize(new Dimension(820, 520));

        model.clear();
        try {
            for (Path p : launcher.listInstances()) model.addElement(p);
        } catch (IOException e) {
            append("读取实例失败: " + e.getMessage());
        }

        list.setCellRenderer((l, value, index, selected, focus) -> {
            JLabel label = new JLabel(instanceLabel(value));
            label.setOpaque(true);
            label.setBorder(BorderFactory.createEmptyBorder(8, 10, 8, 10));
            label.setBackground(selected ? new java.awt.Color(0x2d3644) : new java.awt.Color(0x171b22));
            label.setForeground(new java.awt.Color(0xe6e9ef));
            return label;
        });
        list.setBackground(new java.awt.Color(0x171b22));

        log.setEditable(false);
        log.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
        log.setBackground(new java.awt.Color(0x0f1115));
        log.setForeground(new java.awt.Color(0xc9d1d9));
        ((DefaultCaret) log.getCaret()).setUpdatePolicy(DefaultCaret.ALWAYS_UPDATE);

        JButton launchBtn = new JButton("启动");
        JButton refreshBtn = new JButton("刷新");
        JButton openBtn = new JButton("打开数据目录");

        launchBtn.addActionListener(e -> launchSelected());
        refreshBtn.addActionListener(e -> reload());
        openBtn.addActionListener(e -> {
            try {
                java.awt.Desktop.getDesktop().open(home.toFile());
            } catch (Exception ex) {
                append("打不开目录: " + ex.getMessage());
            }
        });
        list.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) launchSelected();
            }
        });

        JPanel buttons = new JPanel();
        buttons.add(launchBtn);
        buttons.add(refreshBtn);
        buttons.add(openBtn);

        JScrollPane listScroll = new JScrollPane(list);
        listScroll.setPreferredSize(new Dimension(240, 0));
        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, listScroll, new JScrollPane(log));
        split.setDividerLocation(240);

        frame.add(buttons, BorderLayout.NORTH);
        frame.add(split, BorderLayout.CENTER);
        frame.add(new JLabel(" 数据目录: " + home), BorderLayout.SOUTH);
        frame.setSize(900, 560);
        frame.setLocationRelativeTo(null);
        frame.setVisible(true);
        append("TRCL 已就绪，数据目录 " + home);
    }

    void reload() {
        model.clear();
        try {
            for (Path p : launcher.listInstances()) model.addElement(p);
        } catch (IOException e) {
            append("读取实例失败: " + e.getMessage());
        }
    }

    void launchSelected() {
        Path instance = list.getSelectedValue();
        if (instance == null) {
            JOptionPane.showMessageDialog(null, "先选一个实例", "提示", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        if (running.get() != null) {
            append("已经有一个游戏在跑");
            return;
        }
        append("启动 " + instanceLabel(instance));
        new Thread(() -> {
            try {
                Process process = launcher.launch(instance, line -> SwingUtilities.invokeLater(() -> append(line)));
                running.set(process);
                int code = process.waitFor();
                running.set(null);
                SwingUtilities.invokeLater(() -> append("游戏退出，退出码 " + code));
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> append("启动失败: " + e.getMessage()));
            }
        }, "trcl-launch").start();
    }

    final AtomicReference<Process> running = new AtomicReference<>();

    void append(String line) {
        log.append("[" + LocalTime.now().format(CLOCK) + "] " + line + "\n");
    }

    static String instanceLabel(Path dir) {
        try {
            com.google.gson.JsonObject obj = dev.mclauncher.core.Json.readJson(dir.resolve("instance.json"));
            if (obj.has("name") && !obj.get("name").isJsonNull()) return obj.get("name").getAsString();
        } catch (Exception ignored) {
            // 文件名兜底
        }
        return dir.getFileName().toString();
    }

    /** 数据目录：MC_LAUNCHER_HOME > <程序目录>/data > ./data。 */
    static Path resolveHome() {
        String env = System.getenv("MC_LAUNCHER_HOME");
        if (env != null && !env.isBlank()) return Paths.get(env).toAbsolutePath().normalize();
        return Paths.get("data").toAbsolutePath().normalize();
    }
}
