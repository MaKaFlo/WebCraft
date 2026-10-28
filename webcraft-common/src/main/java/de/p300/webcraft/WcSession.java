package de.p300.webcraft;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** One connected browser. Fields are main-thread only unless marked volatile/atomic. */
public final class WcSession {

    private static final AtomicInteger NEXT_ID = new AtomicInteger(1);

    public final int id = NEXT_ID.getAndIncrement();
    public final WebSocket conn;

    public String name;              // full name incl. prefix, null until logged in
    public boolean helloSeen;        // login is running (skin lookup, pre-login event)
    /** Signed skin of the Minecraft account the player chose in the login form, or null (Steve). */
    public volatile com.mojang.authlib.properties.Property skin;
    /** Skin pictures this browser asked for (each only once). */
    public final java.util.Set<String> skinsAsked = java.util.concurrent.ConcurrentHashMap.newKeySet();
    public WcFakePlayer fake;        // the real server player behind this browser (Paper or Fabric version)

    public int centerChunkX = Integer.MIN_VALUE;
    public int centerChunkZ = Integer.MIN_VALUE;
    public String worldName;

    /** Chunks the client has (or is about to receive). */
    public final Set<Long> sentChunks = new HashSet<>();
    /** Chunks still to send, nearest first. */
    public final Deque<Long> chunkQueue = new ArrayDeque<>();
    /** Chunks currently being loaded/encoded. */
    public final AtomicInteger inFlight = new AtomicInteger();   // empty chunks being encoded
    /** Chunks being loaded from the server: key -> start time (ms). Stale ones get retried. */
    public final java.util.Map<Long, Long> loading = new java.util.concurrent.ConcurrentHashMap<>();

    public volatile boolean closed;
    public volatile String tabHeader = "";
    public volatile String tabFooter = "";
    public String lastTab = "";
    final WcScoreboard scoreboard = new WcScoreboard();
    /** Animations seen since the last tick: {entity id, kind} (0 swing, 1 hurt, 3 swing offhand, 4 crit). */
    public final java.util.Queue<int[]> anims = new java.util.concurrent.ConcurrentLinkedQueue<>();
    /** Block changes the server sent to this player (commands, WorldEdit, explosions, water ...): x, y, z, state. */
    public final java.util.Queue<Object[]> blockChanges = new java.util.concurrent.ConcurrentLinkedQueue<>();
    /** Particle and level event packets since the last tick (see WcParticles). */
    public final java.util.Queue<Object> fx = new java.util.concurrent.ConcurrentLinkedQueue<>();
    /** Captured sound packets of this tick (see WcSounds). */
    public final java.util.Queue<Object> sounds = new java.util.concurrent.ConcurrentLinkedQueue<>();
    public final java.util.Set<String> soundsAsked = java.util.concurrent.ConcurrentHashMap.newKeySet();
    public volatile boolean invDirty = true;
    public volatile boolean statsDirty = true;
    public boolean screenOpen;       // browser shows the inventory or a container
    public boolean sentContainer;    // last menu we sent was a container (not the plain inventory)
    public String lastStats = "";
    private final AtomicBoolean kickedOnce = new AtomicBoolean();

    /** How many palette entries this browser already knows. Guarded by this session's lock. */
    private int paletteSent;

    /** Entities that only exist as packets (holograms of plugins like DecentHolograms). */
    public final java.util.Map<Integer, Virtual> virtualEntities = new java.util.concurrent.ConcurrentHashMap<>();

    public static final class Virtual {
        public final int id;
        public final String type;
        public volatile double x, y, z;
        public volatile String text;

        Virtual(int id, String type, double x, double y, double z) {
            this.id = id;
            this.type = type;
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    public void addVirtual(int id, String type, double x, double y, double z) {
        virtualEntities.put(id, new Virtual(id, type, x, y, z));
    }

    /**
     * Sends a message that contains palette ids, after any palette entries the browser does not know yet.
     * Both go out under one lock, so they can never arrive in the wrong order.
     */
    public synchronized void sendWithPalette(BlockPalette palette, Object message) {
        JsonObject pal = palette.messageFrom(paletteSent);
        if (pal != null) {
            send(pal);
            paletteSent = pal.get("start").getAsInt() + pal.getAsJsonArray("entries").size();
        }
        if (message instanceof byte[] bytes) send(bytes);
        else if (message instanceof JsonObject json) send(json);
    }

    public WcSession(WebSocket conn) {
        this.conn = conn;
    }

    public boolean loggedIn() {
        return name != null && fake != null;
    }

    /** Thread-safe send of a JSON message. */
    public void send(JsonObject msg) {
        if (closed || !conn.isOpen()) return;
        try {
            conn.send(msg.toString());
        } catch (Exception ignored) {
            // connection went away in between
        }
    }

    /** Thread-safe send of a binary message. */
    public void send(byte[] data) {
        if (closed || !conn.isOpen()) return;
        try {
            conn.send(data);
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ events from the fake player (any thread)

    public void chat(String text) {
        if (text == null || text.isBlank()) return;
        JsonObject m = new JsonObject();
        m.addProperty("t", "chat");
        m.addProperty("msg", text);
        send(m);
    }

    public void notice(String text) {
        if (text == null || text.isBlank()) return;
        JsonObject m = new JsonObject();
        m.addProperty("t", "notice");
        m.addProperty("msg", text);
        send(m);
    }

    public void knockback(double x, double y, double z) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "vel");
        // Minecraft velocity is blocks per tick, the browser works per second
        m.addProperty("x", x * 20);
        m.addProperty("y", y * 20);
        m.addProperty("z", z * 20);
        send(m);
    }

    public void teleported(int teleportId, double x, double y, double z, float yaw, float pitch) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "tp");
        m.addProperty("id", teleportId);
        m.addProperty("x", x);
        m.addProperty("y", y);
        m.addProperty("z", z);
        m.addProperty("yaw", yaw);
        m.addProperty("pitch", pitch);
        send(m);
    }

    public void died(String message) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "dead");
        m.addProperty("msg", message);
        send(m);
        statsDirty = true;
    }

    /** The server removed the player (kick, ban, ...). Close the browser connection with the reason. */
    public void kicked(String reason) {
        if (!kickedOnce.compareAndSet(false, true)) return;
        JsonObject m = new JsonObject();
        m.addProperty("t", "error");
        m.addProperty("msg", reason == null || reason.isBlank() ? "Vom Server getrennt" : reason);
        send(m);
        closed = true;
        try {
            conn.close(1000, "Kicked");
        } catch (Exception ignored) {
        }
    }

    public static long key(int cx, int cz) {
        return ((long) cx << 32) | (cz & 0xFFFFFFFFL);
    }

    public static int keyX(long key) {
        return (int) (key >> 32);
    }

    public static int keyZ(long key) {
        return (int) key;
    }
}
