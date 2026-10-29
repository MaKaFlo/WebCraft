package de.p300.webcraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * WebCraft accounts linked to Minecraft (Java) accounts. A Java player gets a code with {@code /webcraft link},
 * the WebCraft player types it with {@code /webcraft link <code>}; from then on the WebCraft login plays as the
 * Java account (same UUID, same player data). Stored in {@code links.json}: WebCraft account name (lower case,
 * with prefix) -> {uuid, name}.
 */
public final class WcLinks {

    /** A Java account: its UUID and last known name. */
    public record Account(UUID uuid, String name) {
    }

    private record Pending(Account account, long until) {
    }

    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final long CODE_MS = 10 * 60 * 1000L;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final Path file;
    private final Logger log;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Account> links = new HashMap<>();
    private final Map<String, Pending> codes = new HashMap<>();

    public WcLinks(Path file, Logger log) {
        this.file = file;
        this.log = log;
        load();
    }

    private static String key(String account) {
        return account.toLowerCase(Locale.ROOT);
    }

    /** The Java account a WebCraft account (with prefix) plays as, or null. */
    public synchronized Account of(String webcraftAccount) {
        return links.get(key(webcraftAccount));
    }

    /** WebCraft accounts linked to a Java account. */
    public synchronized List<String> linkedTo(UUID uuid) {
        List<String> out = new ArrayList<>();
        for (var e : links.entrySet()) if (e.getValue().uuid().equals(uuid)) out.add(e.getKey());
        return out;
    }

    /** A new code for a Java account (an older code of it stops working). */
    public synchronized String newCode(UUID uuid, String name) {
        long now = System.currentTimeMillis();
        codes.values().removeIf(p -> p.until() < now || p.account().uuid().equals(uuid));
        String code;
        do {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 6; i++) b.append(CODE_CHARS.charAt(random.nextInt(CODE_CHARS.length())));
            code = b.toString();
        } while (codes.containsKey(code));
        codes.put(code, new Pending(new Account(uuid, name), now + CODE_MS));
        return code;
    }

    /** Looks like a code (so "/webcraft ABC123" works without "link"). */
    public static boolean isCode(String s) {
        if (s == null || s.length() != 6) return false;
        for (char c : s.toUpperCase(Locale.ROOT).toCharArray()) if (CODE_CHARS.indexOf(c) < 0) return false;
        return true;
    }

    /** Links a WebCraft account with the Java account of a code. Returns that account, or null for a wrong/old code. */
    public synchronized Account redeem(String code, String webcraftAccount) {
        Pending p = codes.remove(code.toUpperCase(Locale.ROOT));
        if (p == null || p.until() < System.currentTimeMillis()) return null;
        // One WebCraft account per Minecraft account
        links.values().removeIf(a -> a.uuid().equals(p.account().uuid()));
        links.put(key(webcraftAccount), p.account());
        save();
        return p.account();
    }

    /** Links directly (admin page): one WebCraft account per Minecraft account, like with a code. */
    public synchronized void link(String webcraftAccount, UUID uuid, String name) {
        links.values().removeIf(a -> a.uuid().equals(uuid));
        links.put(key(webcraftAccount), new Account(uuid, name));
        save();
    }

    /** Removes the link of a WebCraft account. Returns the Java account it had, or null. */
    public synchronized Account unlink(String webcraftAccount) {
        Account a = links.remove(key(webcraftAccount));
        if (a != null) save();
        return a;
    }

    /** Removes all links of a Java account. Returns the WebCraft accounts that were linked. */
    public synchronized List<String> unlink(UUID uuid) {
        List<String> gone = linkedTo(uuid);
        if (!gone.isEmpty()) {
            for (String k : gone) links.remove(k);
            save();
        }
        return gone;
    }

    /** The Java player joined: keep the name current (Minecraft names can change). */
    public synchronized void seen(UUID uuid, String name) {
        boolean changed = false;
        for (var e : links.entrySet()) {
            if (e.getValue().uuid().equals(uuid) && !e.getValue().name().equals(name)) {
                e.setValue(new Account(uuid, name));
                changed = true;
            }
        }
        if (changed) save();
    }

    private void load() {
        if (!Files.exists(file)) return;
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            if (o == null) return;
            for (var e : o.entrySet()) {
                JsonObject a = e.getValue().getAsJsonObject();
                links.put(key(e.getKey()), new Account(UUID.fromString(a.get("uuid").getAsString()), a.get("name").getAsString()));
            }
        } catch (Exception e) {
            log.log(Level.WARNING, "Could not read " + file, e);
        }
    }

    private void save() {
        JsonObject o = new JsonObject();
        for (var e : links.entrySet()) {
            JsonObject a = new JsonObject();
            a.addProperty("uuid", e.getValue().uuid().toString());
            a.addProperty("name", e.getValue().name());
            o.add(e.getKey(), a);
        }
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, GSON.toJson(o), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.log(Level.WARNING, "Could not write " + file, e);
        }
    }
}
