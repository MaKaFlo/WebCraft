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

    // ------------------------------------------------------------------ the same in game: /webcraft account ...

    /** Message lines for an admin in game: [text, kind] with kind "ok", "err", "info" or "secret" (a password). */
    public interface Reply {
        void line(String text, String kind);
    }

    public static final String ACCOUNT_USAGE = "/webcraft account <create|password|reset|link|unlink|list> ...";

    /** {@code /webcraft account ...} (admins only, main thread). args[0] = "account". */
    public void command(String[] args, Reply out) {
        String sub = args.length > 1 ? args[1].toLowerCase(java.util.Locale.ROOT) : "list";
        String name = args.length > 2 ? strip(args[2]) : null;
        String account = name == null ? null : platform.namePrefix() + name;
        switch (sub) {
            case "list" -> {
                List<String> online = platform.online();
                TreeSet<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
                names.addAll(accounts.names());
                names.addAll(online);
                out.line("WebCraft-Konten (" + names.size() + "):", "info");
                for (String n : names) {
                    WcLinks.Account l = links.of(n);
                    boolean on = online.stream().anyMatch(o -> o.equalsIgnoreCase(n));
                    out.line(" - " + n + (accounts.hasPassword(n) ? "" : " (kein Passwort)") + (l != null ? " = Minecraft " + l.name() : "")
                            + (on ? " [online]" : ""), "info");
                }
                if (!platform.selfRegister()) out.line("Neue Spieler können sich nicht selbst anmelden (self-register: false).", "info");
            }
            case "create", "password" -> {
                if (name == null || !NAME.matcher(name).matches()) {
                    out.line("Benutzung: /webcraft account " + sub + " <name> [passwort]  (Name: 3-13 Zeichen, Buchstaben, Zahlen, _)", "err");
                    return;
                }
                boolean create = sub.equals("create");
                if (create && accounts.hasPassword(account)) {
                    out.line(account + " gibt es schon. Neues Passwort: /webcraft account password " + name, "err");
                    return;
                }
                if (!create && !accounts.hasPassword(account) && !platform.online().stream().anyMatch(account::equalsIgnoreCase)) {
                    out.line("Hinweis: " + account + " hatte noch kein Passwort.", "info");
                }
                // No password given: a random one (then it is not in the server log, typed commands are)
                String pw = args.length > 3 ? args[3] : randomPassword();
                if (pw.length() < WcAccounts.MIN_LENGTH || pw.length() > 64) {
                    out.line("Das Passwort braucht 4 bis 64 Zeichen.", "err");
                    return;
                }
                CompletableFuture.runAsync(() -> accounts.set(account, pw)).whenComplete((ok, err) -> host.runSync(() -> {
                    if (err != null) {
                        out.line("Fehler beim Speichern, siehe Server-Log.", "err");
                        return;
                    }
                    if (create) platform.whitelist(account);
                    host.logger().info("WebCraft: " + (create ? "account created: " : "new password for ") + account);
                    out.line(create ? account + " angelegt." : "Neues Passwort für " + account + " gespeichert.", "ok");
                    out.line("Anmelden auf der WebCraft-Seite mit Name: " + name + "  Passwort: " + pw, "secret");
                }));
            }
            case "reset" -> {
                if (account == null) { out.line("Benutzung: /webcraft account reset <name>", "err"); return; }
                boolean had = accounts.reset(account);
                out.line(had ? "Passwort von " + account + " gelöscht: beim nächsten Anmelden legt der Spieler ein neues fest."
                        : account + " hat kein Passwort.", had ? "ok" : "err");
            }
            case "link" -> {
                String mc = args.length > 3 ? args[3] : null;
                if (name == null || mc == null) { out.line("Benutzung: /webcraft account link <webcraft-name> <minecraft-spieler>", "err"); return; }
                java.util.UUID uuid = null;
                String mcName = null;
                for (var e : platform.minecraftPlayers().entrySet()) {
                    if (e.getKey().equalsIgnoreCase(mc)) { mcName = e.getKey(); uuid = e.getValue(); }
                }
                if (uuid == null) {
                    out.line("Den Minecraft-Spieler " + mc + " kennt der Server nicht (er muss einmal mit Minecraft da gewesen sein).", "err");
                    return;
                }
                links.link(account, uuid, mcName);
                platform.kick(account);
                host.logger().info("WebCraft: linked " + account + " with " + mcName + " (" + uuid + ")");
                out.line(account + " ist jetzt mit " + mcName + " verknüpft: gleicher Spieler, gleiche Items.", "ok");
            }
            case "unlink" -> {
                if (account == null) { out.line("Benutzung: /webcraft account unlink <name>", "err"); return; }
                boolean had = links.unlink(account) != null;
                if (had) platform.kick(account);
                out.line(had ? "Verknüpfung von " + account + " aufgehoben." : account + " ist nicht verknüpft.", had ? "ok" : "err");
            }
            default -> out.line("Benutzung: " + ACCOUNT_USAGE, "err");
        }
    }

    /** Tab completion of /webcraft account ... (args[0] = "account"). */
    public List<String> complete(String[] args) {
        List<String> out = new java.util.ArrayList<>();
        if (args.length == 2) out.addAll(List.of("create", "password", "reset", "link", "unlink", "list"));
        else if (args.length == 3 && !args[1].equalsIgnoreCase("create") && !args[1].equalsIgnoreCase("list")) {
            for (String n : accounts.names()) out.add(strip(n));
            for (String n : platform.online()) out.add(strip(n));
        } else if (args.length == 4 && args[1].equalsIgnoreCase("link")) {
            out.addAll(platform.minecraftPlayers().keySet());
        }
        String start = args[args.length - 1].toLowerCase(java.util.Locale.ROOT);
        out.removeIf(o -> !o.toLowerCase(java.util.Locale.ROOT).startsWith(start));
        return new java.util.ArrayList<>(new java.util.TreeSet<>(out));
    }

    /** "wc_max" or "Max" -> "Max" (the name without the prefix). */
    private String strip(String name) {
        String p = platform.namePrefix();
        return name.toLowerCase(java.util.Locale.ROOT).startsWith(p.toLowerCase(java.util.Locale.ROOT)) ? name.substring(p.length()) : name;
    }

    private String randomPassword() {
        String chars = "abcdefghjkmnpqrstuvwxyz23456789";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 8; i++) b.append(chars.charAt(random.nextInt(chars.length())));
        return b.toString();
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
