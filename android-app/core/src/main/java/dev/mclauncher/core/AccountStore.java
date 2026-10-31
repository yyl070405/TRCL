package dev.mclauncher.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** 账号持久化：<root>/accounts.json。 */
public final class AccountStore {
    public static final class Store {
        public String selected;
        public List<MicrosoftAuth.Account> accounts = new ArrayList<MicrosoftAuth.Account>();
    }

    private final Path file;
    private Store store = new Store();

    public AccountStore(Path file) {
        this.file = file;
    }

    public void load() throws IOException {
        if (Files.isRegularFile(file)) {
            Store loaded = Json.read(file, Store.class);
            if (loaded != null && loaded.accounts != null) {
                store = loaded;
            }
        }
    }

    public void save() throws IOException {
        Json.write(file, store);
    }

    public List<MicrosoftAuth.Account> list() {
        return store.accounts;
    }

    public MicrosoftAuth.Account current() {
        if (store.accounts.isEmpty()) {
            return null;
        }
        for (MicrosoftAuth.Account a : store.accounts) {
            if (a.uuid != null && a.uuid.equals(store.selected)) {
                return a;
            }
        }
        return store.accounts.get(0);
    }

    public void add(MicrosoftAuth.Account account) {
        for (int i = 0; i < store.accounts.size(); i++) {
            if (store.accounts.get(i).uuid != null && store.accounts.get(i).uuid.equals(account.uuid)) {
                store.accounts.set(i, account);
                store.selected = account.uuid;
                return;
            }
        }
        store.accounts.add(account);
        store.selected = account.uuid;
    }

    public void select(String uuid) {
        store.selected = uuid;
    }

    public void remove(String uuid) {
        for (int i = store.accounts.size() - 1; i >= 0; i--) {
            if (uuid.equals(store.accounts.get(i).uuid)) {
                store.accounts.remove(i);
            }
        }
        if (uuid.equals(store.selected)) {
            store.selected = store.accounts.isEmpty() ? null : store.accounts.get(0).uuid;
        }
    }
}
