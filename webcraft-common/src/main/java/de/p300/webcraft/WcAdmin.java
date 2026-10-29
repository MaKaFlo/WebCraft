package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;

/**
 * Admin page in the browser: {@code /webcraft admin} gives an admin a link with a token (30 minutes), the page
 * opens with {@code ?admin=<token>} and sends {@code admin} {token}. That connection then manages WebCraft accounts:
 * {@code admin_create} {name, pw}, {@code admin_pw} {name, pw}, {@code admin_reset} {name}, {@code admin_kick} {name},
 * {@code admin_link} {name, mc} (with a Minecraft player that was on the server), {@code admin_unlink} {name},
 * {@code admin_list}. Only server admins get a token. Answers: {@code admin} {ok, prefix, selfRegister, accounts: [{n, pw, online, linked}], players: [Minecraft names], msg, err}.
 */
public final class WcAdmin {

    /** What the admin page needs from the Paper plugin / Fabric mod (called on the main thread). */
    public interface Platform {
        String namePrefix();

        /** WebCraft accounts (prefix + name) playing right now. */
        List<String> online();

        /** Puts the WebCraft player on the whitelist (when the server uses one). */
        void whitelist(String account);

        /** Throws the WebCraft player out. Returns false when not online. */
        boolean kick(String account);

        /** Whether players may set the password of a new account themselves. */
        boolean selfRegister();

        /** Minecraft (Java) players that were on the server: name -> UUID. */
        Map<String, java.util.UUID> minecraftPlayers();
    }

    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_]{3,13}$");
    private static final long TOKEN_MS = 30 * 60 * 1000L;

    private final WcHost host;
    private final WcAccounts accounts;
    private final WcLinks links;
    private final Platform platform;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Long> tokens = new HashMap<>();

    public WcAdmin(WcHost host, WcAccounts accounts, WcLinks links, Platform platform) {
        this.host = host;
        this.accounts = accounts;
        this.links = links;
        this.platform = platform;
    }

    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private int fails;
    private long lockedUntil;

    /** A new code for the admin page: 8 letters/digits, easy to type (also on a phone). */
    public synchronized String newToken() {
        long now = System.currentTimeMillis();
        tokens.values().removeIf(until -> until < now);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 8; i++) b.append(CODE_CHARS.charAt(random.nextInt(CODE_CHARS.length())));
        String t = b.toString();
        tokens.put(t, now + TOKEN_MS);
        return t;
    }

    /** Checks a code; 10 wrong ones lock the admin page for 10 minutes (no guessing). */
    private synchronized boolean valid(String token) {
        long now = System.currentTimeMillis();
        if (now < lockedUntil) return false;
        String t = token == null ? "" : token.replaceAll("[\\s-]", "").toUpperCase(java.util.Locale.ROOT);
        Long until = tokens.get(t);
        if (until != null && until > now) return true;
        if (++fails >= 10) {
            fails = 0;
            lockedUntil = now + 10 * 60 * 1000L;
            host.logger().warning("WebCraft admin page: too many wrong codes, locked for 10 minutes");
        }
        return false;
    }

    /** The browser of a WebCraft player who typed /webcraft admin opens the admin page by itself. */
    public void openFor(WcSession s, String token) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "admin_open");
        m.addProperty("token", token);
        s.send(m);
    }

    /** The admin page link, or null when the server does not know the page's address. */
    public static String link(String webUrl, String token) {
        if (webUrl == null || webUrl.isBlank()) return null;
        return webUrl.trim() + (webUrl.contains("?") ? "&" : "?") + "admin=" + token;
    }

    /** Handles an admin message (main thread). Returns false when it was none. */
    public boolean handle(WcSession s, String type, JsonObject json) {
        if (!type.startsWith("admin")) return false;
        if (type.equals("admin")) {
            if (!valid(str(json, "token"))) {
                JsonObject err = new JsonObject();
                err.addProperty("t", "admin");
                err.addProperty("ok", false);
                err.addProperty("err", "Der Admin-Code ist falsch oder abgelaufen. Tippe im Spiel neu /webcraft admin.");
                s.send(err);
                s.conn.close(1000, "Bad admin token");
                return true;
            }
            s.admin = true;
            host.logger().info("WebCraft admin page opened from " + s.conn.getRemoteSocketAddress());
            answer(s, null, null);
            return true;
        }
        if (!s.admin) {
            s.conn.close(1008, "Not admin");
            return true;
        }
        String name = str(json, "name");
        String account = name == null ? null : platform.namePrefix() + name;
        switch (type) {
            case "admin_list" -> answer(s, null, null);
            case "admin_create", "admin_pw" -> {
                String pw = str(json, "pw");
                if (name == null || !NAME.matcher(name).matches()) {
                    answer(s, null, "Name: 3 bis 13 Zeichen, nur Buchstaben, Zahlen und _");
                    return true;
                }
                if (pw == null || pw.length() < WcAccounts.MIN_LENGTH || pw.length() > 64) {
                    answer(s, null, "Das Passwort braucht 4 bis 64 Zeichen.");
                    return true;
                }
                boolean create = type.equals("admin_create");
                if (create && accounts.hasPassword(account)) {
                    answer(s, null, account + " gibt es schon. Ändere dort das Passwort.");
                    return true;
                }
                // Hashing is slow: not on the server thread
                CompletableFuture.runAsync(() -> accounts.set(account, pw)).whenComplete((ok, err) -> host.runSync(() -> {
                    if (err != null) {
                        answer(s, null, "Fehler beim Speichern, siehe Server-Log.");
                        return;
                    }
                    if (create) platform.whitelist(account);
                    host.logger().info("WebCraft admin page: " + (create ? "created " : "new password for ") + account);
                    answer(s, create ? account + " angelegt. Anmelden mit Name " + name + " und dem Passwort."
                            : "Neues Passwort für " + account + " gespeichert.", null);
                }));
            }
            case "admin_reset" -> {
                boolean had = account != null && accounts.reset(account);
                answer(s, had ? "Passwort von " + account + " gelöscht." : null, had ? null : account + " hat kein Passwort.");
            }
            case "admin_link" -> {
                String mc = str(json, "mc");
                java.util.UUID uuid = null;
                String mcName = null;
                for (var e : platform.minecraftPlayers().entrySet()) {
                    if (e.getKey().equalsIgnoreCase(mc == null ? "" : mc.trim())) { mcName = e.getKey(); uuid = e.getValue(); }
                }
                if (account == null || !NAME.matcher(name).matches()) {
                    answer(s, null, "Name: 3 bis 13 Zeichen, nur Buchstaben, Zahlen und _");
                } else if (uuid == null) {
                    answer(s, null, "Den Minecraft-Spieler " + mc + " kennt der Server nicht (er muss einmal mit Minecraft da gewesen sein).");
                } else {
                    links.link(account, uuid, mcName);
                    platform.kick(account);   // plays as the Minecraft account from the next login on
                    host.logger().info("WebCraft admin page: linked " + account + " with " + mcName + " (" + uuid + ")");
                    answer(s, account + " ist jetzt mit " + mcName + " verknüpft: gleicher Spieler, gleiche Items.", null);
                }
            }
            case "admin_unlink" -> {
                boolean had = account != null && links.unlink(account) != null;
                if (had) platform.kick(account);
                answer(s, had ? "Verknüpfung von " + account + " aufgehoben." : null, had ? null : account + " ist nicht verknüpft.");
            }
            case "admin_kick" -> {
                boolean done = account != null && platform.kick(account);
                answer(s, done ? account + " rausgeworfen." : null, done ? null : account + " ist nicht online.");
            }
            default -> { }
        }
        return true;
    }

    private void answer(WcSession s, String msg, String err) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "admin");
        m.addProperty("ok", true);
        m.addProperty("prefix", platform.namePrefix());
        m.addProperty("selfRegister", platform.selfRegister());
        if (msg != null) m.addProperty("msg", msg);
        if (err != null) m.addProperty("err", err);
        List<String> online = platform.online();
        TreeSet<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        names.addAll(accounts.names());
        names.addAll(online);
        JsonArray list = new JsonArray();
        for (String n : names) {
            JsonObject a = new JsonObject();
            a.addProperty("n", n);
            a.addProperty("pw", accounts.hasPassword(n));
            if (online.stream().anyMatch(o -> o.equalsIgnoreCase(n))) a.addProperty("online", true);
            WcLinks.Account linked = links.of(n);
            if (linked != null) a.addProperty("linked", linked.name());
            list.add(a);
        }
        m.add("accounts", list);
        JsonArray players = new JsonArray();
        new TreeSet<>(platform.minecraftPlayers().keySet()).forEach(players::add);
        m.add("players", players);
        s.send(m);
    }

    private static String str(JsonObject o, String key) {
        var e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : null;
    }
}
