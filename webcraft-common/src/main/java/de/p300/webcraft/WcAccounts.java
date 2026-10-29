package de.p300.webcraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Passwords of WebCraft accounts ({@code passwords.json}: account lower case -> {salt, hash}, PBKDF2-SHA256).
 * The first login of an account sets its password (also for accounts that played before passwords existed);
 * after that name + password are needed. Several wrong passwords lock the account for a minute.
 * Hashing is slow on purpose: call {@link #check} off the server thread.
 */
public final class WcAccounts {

    public enum Result { OK, REGISTERED, NEED_PASSWORD, WRONG, LOCKED, TOO_SHORT }

    public static final int MIN_LENGTH = 4;
    private static final int ITERATIONS = 120_000;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private record Entry(String salt, String hash) {
    }

    private final Path file;
    private final Logger log;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Entry> entries = new HashMap<>();
    private final Map<String, int[]> fails = new HashMap<>();      // account -> {count}
    private final Map<String, Long> lockedUntil = new HashMap<>();

    public WcAccounts(Path file, Logger log) {
        this.file = file;
        this.log = log;
        load();
    }

    private static String key(String account) {
        return account.toLowerCase(Locale.ROOT);
    }

    public synchronized boolean hasPassword(String account) {
        return entries.containsKey(key(account));
    }

    /**
     * Checks a login. Without a password set yet, {@code register} with a long enough password sets it
     * (REGISTERED), else NEED_PASSWORD (the browser then asks for a new password).
     */
    public Result check(String account, String password, boolean register) {
        String k = key(account);
        Entry e;
        synchronized (this) {
            Long until = lockedUntil.get(k);
            if (until != null && until > System.currentTimeMillis()) return Result.LOCKED;
            e = entries.get(k);
        }
        if (e == null) {
            if (!register || password == null) return Result.NEED_PASSWORD;
            if (password.length() < MIN_LENGTH) return Result.TOO_SHORT;
            set(account, password);
            return Result.REGISTERED;
        }
        if (password != null && MessageDigest.isEqual(hash(password, Base64.getDecoder().decode(e.salt())),
                Base64.getDecoder().decode(e.hash()))) {
            synchronized (this) {
                fails.remove(k);
            }
            return Result.OK;
        }
        synchronized (this) {
            int n = ++fails.computeIfAbsent(k, x -> new int[1])[0];
            if (n >= 5) {
                fails.remove(k);
                lockedUntil.put(k, System.currentTimeMillis() + 60_000);
            }
        }
        return Result.WRONG;
    }

    /** Sets (or changes) the password of an account. */
    public void set(String account, String password) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        Entry e = new Entry(Base64.getEncoder().encodeToString(salt), Base64.getEncoder().encodeToString(hash(password, salt)));
        synchronized (this) {
            entries.put(key(account), e);
            save();
        }
    }

    /** Removes the password (an admin reset): the next login sets a new one. */
    public synchronized boolean reset(String account) {
        boolean had = entries.remove(key(account)) != null;
        lockedUntil.remove(key(account));
        if (had) save();
        return had;
    }

    private static byte[] hash(String password, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (Exception ex) {
            throw new IllegalStateException("PBKDF2 not available", ex);
        }
    }

    private void load() {
        if (!Files.exists(file)) return;
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            if (o == null) return;
            for (var e : o.entrySet()) {
                JsonObject a = e.getValue().getAsJsonObject();
                entries.put(key(e.getKey()), new Entry(a.get("salt").getAsString(), a.get("hash").getAsString()));
            }
        } catch (Exception e) {
            log.log(Level.WARNING, "Could not read " + file, e);
        }
    }

    private void save() {
        JsonObject o = new JsonObject();
        for (var e : entries.entrySet()) {
            JsonObject a = new JsonObject();
            a.addProperty("salt", e.getValue().salt());
            a.addProperty("hash", e.getValue().hash());
            o.add(e.getKey(), a);
        }
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, GSON.toJson(o), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.log(Level.WARNING, "Could not write " + file, e);
        }
    }

    /** The error message for the browser, or null when the login may go on. */
    public static JsonObject refusal(Result r) {
        String msg = switch (r) {
            case OK, REGISTERED -> null;
            case NEED_PASSWORD -> "Neues Konto: lege ein Passwort fest (mindestens " + MIN_LENGTH + " Zeichen).";
            case TOO_SHORT -> "Das Passwort braucht mindestens " + MIN_LENGTH + " Zeichen.";
            case WRONG -> "Falsches Passwort.";
            case LOCKED -> "Zu viele falsche Passwörter. Warte eine Minute.";
        };
        if (msg == null) return null;
        JsonObject err = new JsonObject();
        err.addProperty("t", "error");
        err.addProperty("msg", msg);
        if (r == Result.NEED_PASSWORD || r == Result.TOO_SHORT) err.addProperty("register", true);
        return err;
    }
}
