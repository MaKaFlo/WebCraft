package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.players.PlayerList;
import net.minecraft.util.StringRepresentable;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Relative;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.sheep.Sheep;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.ItemSupplier;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.entity.vehicle.VehicleEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.border.WorldBorder;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.io.File;
import java.io.IOException;
import java.io.Reader;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * WebCraft for Fabric servers (and so for "vanilla" with Fabric installed). Same features and the same
 * browser protocol as the Paper plugin; settings in config/webcraft/webcraft.properties.
 */
public final class WcMod implements ModInitializer, WcHost {

    private static final Pattern NAME_PATTERN = Pattern.compile("^[A-Za-z0-9_]{3,13}$");
    private static final int MAX_PENDING_BLOCKS = 20000;
    private static final int MAX_ENTITIES = 120;
    private static final org.slf4j.Logger SLF = org.slf4j.LoggerFactory.getLogger("WebCraft");

    // Settings
    private String host;
    private int port;
    private String worldName;
    private String namePrefix;
    private int maxPlayers;
    private int viewDistance;
    private int chunksPerTick;
    private double entityRange;
    private List<String> allowedOrigins;
    private boolean logBlocks;

    private final Logger logger = julBridge();
    private final File dataFolder = FabricLoader.getInstance().getConfigDir().resolve("webcraft").toFile();
    private volatile MinecraftServer server;
    private BlockPalette palette;
    private WcSkins skins;
    private WcServer socket;
    private WcTextures textures;
    private WcBlockLog blockLog;
    private ExecutorService encoder;
    private final Map<Integer, WcSession> sessions = new ConcurrentHashMap<>(); // logged-in sessions
    private final Map<UUID, WcSession> byPlayer = new ConcurrentHashMap<>();
    private final Set<BlockAt> pendingBlocks = new HashSet<>();
    private final List<Later> later = new ArrayList<>();
    private long tickCounter;

    record BlockAt(ResourceKey<Level> dim, int x, int y, int z) {}

    private record Later(long tick, Runnable task) {}

    // ------------------------------------------------------------------ lifecycle

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(this::start);
        ServerLifecycleEvents.SERVER_STOPPING.register(s -> stop());
        ServerTickEvents.END_SERVER_TICK.register(s -> tick());
        CommandRegistrationCallback.EVENT.register((dispatcher, context, selection) -> registerCommands(dispatcher));
        PlayerBlockBreakEvents.AFTER.register((level, player, pos, state, blockEntity) -> {
            if (player instanceof ServerPlayer sp) {
                logBlock(sp, "break", pos, state);
                queueBlockCheck(level.dimension(), pos.getX(), pos.getY() + 1, pos.getZ()); // flowers, torches on top
            }
        });
    }

    private void start(MinecraftServer server) {
        this.server = server;
        loadSettings();
        palette = new BlockPalette(logger);
        textures = new WcTextures(dataFolder, logger);
        textures.load();
        blockLog = new WcBlockLog(new File(dataFolder, "blocklog.csv"), logger);
        skins = new WcSkins(new File(dataFolder, "skins").toPath(), logger);
        encoder = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "WebCraft chunk encoder");
            t.setDaemon(true);
            return t;
        });
        startSocket();
    }

    private void stop() {
        stopSocket();
        for (WcSession s : new ArrayList<>(sessions.values())) {
            s.closed = true;
            if (s.fake != null) s.fake.remove();
        }
        sessions.clear();
        byPlayer.clear();
        if (encoder != null) encoder.shutdownNow();
        server = null;
    }

    private void loadSettings() {
        Path file = dataFolder.toPath().resolve("webcraft.properties");
        Properties p = new Properties();
        try {
            Files.createDirectories(dataFolder.toPath());
            if (!Files.exists(file)) {
                try (var in = WcMod.class.getResourceAsStream("/webcraft.properties")) {
                    if (in != null) Files.copy(in, file);
                }
            }
            try (Reader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                p.load(r);
            }
        } catch (IOException e) {
            logger.log(java.util.logging.Level.WARNING, "Could not read " + file + ", using the defaults", e);
        }
        host = p.getProperty("host", "0.0.0.0").trim();
        port = intProp(p, "port", 25007);
        worldName = p.getProperty("world", "").trim();
        namePrefix = p.getProperty("name-prefix", "wc_").trim();
        maxPlayers = intProp(p, "max-players", 10);
        viewDistance = Math.max(2, Math.min(16, intProp(p, "view-distance", 6)));
        chunksPerTick = Math.max(1, intProp(p, "chunks-per-tick", 3));
        entityRange = intProp(p, "entity-range", 64);
        allowedOrigins = Arrays.stream(p.getProperty("allowed-origins", "").split(","))
                .map(String::trim).filter(o -> !o.isEmpty()).toList();
        logBlocks = Boolean.parseBoolean(p.getProperty("log-blocks", "true").trim());
    }

    private static int intProp(Properties p, String key, int fallback) {
        try {
            return Integer.parseInt(p.getProperty(key, String.valueOf(fallback)).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void startSocket() {
        socket = new WcServer(this, new InetSocketAddress(host, port), allowedOrigins);
        socket.start();
    }

    private void stopSocket() {
        if (socket == null) return;
        try {
            socket.stop(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        socket = null;
    }

    MinecraftServer server() {
        return server;
    }

    @Override
    public void runSync(Runnable r) {
        MinecraftServer s = server;
        if (s == null) return;
        if (s.isSameThread()) r.run();
        else s.execute(r);
    }

    @Override
    public Logger logger() {
        return logger;
    }

    /** The shared code logs with java.util.logging; send that to the server log. */
    private static Logger julBridge() {
        Logger l = Logger.getLogger("WebCraft");
        l.setUseParentHandlers(false);
        l.addHandler(new java.util.logging.Handler() {
            @Override
            public void publish(java.util.logging.LogRecord rec) {
                String msg = rec.getMessage();
                if (rec.getLevel().intValue() >= java.util.logging.Level.SEVERE.intValue()) SLF.error(msg, rec.getThrown());
                else if (rec.getLevel().intValue() >= java.util.logging.Level.WARNING.intValue()) SLF.warn(msg, rec.getThrown());
                else SLF.info(msg);
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        });
        return l;
    }

    private ServerLevel joinLevel() {
        if (worldName != null && !worldName.isEmpty()) {
            Identifier id = Identifier.tryParse(worldName);
            ServerLevel l = id == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, id));
            if (l != null) return l;
        }
        return server.overworld();
    }

    // ------------------------------------------------------------------ messages from the browser

    @Override
    public void handleMessage(WcSession s, JsonObject json) {
        if (s.closed || server == null) return;
        String type = str(json, "t");
        if (type == null) return;
        if (!s.loggedIn()) {
            if ("hello".equals(type) && s.name == null && !s.helloSeen) {
                s.helloSeen = true;
                String name = str(json, "name"), skin = str(json, "skin");
                // Skin of the chosen Minecraft account first (asks Mojang, so not on the server thread)
                java.util.concurrent.CompletableFuture.runAsync(() -> {
                    if (skin != null && !skin.isBlank()) s.skin = skins.lookup(skin.trim());
                }).whenComplete((ok, err) -> server.execute(() -> {
                    if (!s.closed) login(s, name);
                }));
            }
            else if (s.name == null) s.conn.close(1008, "Login first");
            return;
        }
        if (s.fake.isRemoved()) return;
        WcFakePlayer f = s.fake;
        ServerPlayer p = f.handle();
        try {
            switch (type) {
                case "move" -> {
                    if (p.isDeadOrDying()) return;
                    double x = num(json, "x"), y = num(json, "y"), z = num(json, "z");
                    float yaw = (float) num(json, "yaw"), pitch = (float) num(json, "pitch");
                    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                            || !Float.isFinite(yaw) || !Float.isFinite(pitch)) return;
                    f.move(x, y, z, yaw, Math.max(-90f, Math.min(90f, pitch)), bool(json, "g"));
                }
                case "input" -> f.input(bool(json, "f"), bool(json, "b"), bool(json, "l"), bool(json, "r"),
                        bool(json, "j"), bool(json, "s"), bool(json, "sp"));
                case "tp_ok" -> f.confirmTeleport(integer(json, "id"), num(json, "x"), num(json, "y"), num(json, "z"),
                        (float) num(json, "yaw"), (float) num(json, "pitch"));
                case "dig_start" -> {
                    int x = integer(json, "x"), y = integer(json, "y"), z = integer(json, "z");
                    int need = digTicks(p, x, y, z);       // before digging: an instant break makes it air
                    f.dig("start", x, y, z, integer(json, "face"));
                    sendDigInfo(s, x, y, z, need);
                }
                case "dig_stop" -> {
                    int x = integer(json, "x"), y = integer(json, "y"), z = integer(json, "z");
                    f.dig("stop", x, y, z, integer(json, "face"));
                    confirmBlocks(p.level().dimension(), x, y, z);
                }
                case "dig_abort" -> f.dig("abort", integer(json, "x"), integer(json, "y"), integer(json, "z"), integer(json, "face"));
                case "use_on" -> {
                    int x = integer(json, "x"), y = integer(json, "y"), z = integer(json, "z"), face = integer(json, "face");
                    ServerLevel level = p.level();
                    BlockPos target = new BlockPos(x, y, z);
                    BlockPos next = target.relative(net.minecraft.core.Direction.values()[Math.floorMod(face, 6)]);
                    BlockState beforeTarget = level.getBlockState(target), beforeNext = level.getBlockState(next);
                    f.useOn(x, y, z, face, num(json, "hx"), num(json, "hy"), num(json, "hz"));
                    // Placed a block (on the clicked side, or replacing grass/snow ...): write it to the block log
                    BlockState afterNext = level.getBlockState(next), afterTarget = level.getBlockState(target);
                    if (beforeNext != afterNext && !afterNext.isAir() && beforeNext.canBeReplaced()) logBlock(p, "place", next, afterNext);
                    else if (beforeTarget != afterTarget && beforeTarget.canBeReplaced() && !afterTarget.isAir()) logBlock(p, "place", target, afterTarget);
                    confirmBlocks(level.dimension(), x, y, z);
                }
                case "use" -> f.useItem();
                case "release" -> f.releaseUse();
                case "attack" -> f.attack(integer(json, "id"));
                case "punch" -> f.punch();
                case "interact" -> f.interact(integer(json, "id"), num(json, "hx"), num(json, "hy"), num(json, "hz"));
                case "button" -> { f.menuButton(integer(json, "id")); s.invDirty = true; }
                case "trade" -> { f.selectTrade(integer(json, "i")); s.invDirty = true; }
                case "skin" -> sendSkin(s, str(json, "h"));
                case "beacon" -> { f.beacon(str(json, "p"), str(json, "s")); s.invDirty = true; }
                case "rename" -> { f.rename(str(json, "name")); s.invDirty = true; }
                case "swing" -> f.swing();   // only the animation (digging), no click
                case "slot" -> f.selectSlot(Math.max(0, Math.min(8, integer(json, "i"))));
                case "drop" -> f.drop(bool(json, "all"));
                case "swap_hands" -> f.swapHands();
                case "inv_open" -> {
                    f.openOwnInventory();
                    s.screenOpen = true;
                    s.invDirty = true;
                }
                case "close" -> {
                    f.closeMenu();
                    s.screenOpen = false;
                    s.invDirty = true;
                }
                case "click" -> {
                    String mode = str(json, "mode");
                    f.click(integer(json, "slot"), integer(json, "btn"), mode == null ? "pickup" : mode);
                    s.invDirty = true;
                }
                case "creative" -> {
                    int slot = integer(json, "slot");
                    String key = str(json, "k");
                    if (slot < 5 || slot > 45) return;
                    if (key == null || key.isEmpty()) {
                        f.creativeSet(slot, null);
                    } else {
                        Identifier id = Identifier.tryParse(key);
                        Optional<Holder.Reference<Item>> item = id == null ? Optional.empty() : BuiltInRegistries.ITEM.get(id);
                        if (item.isEmpty() || item.get().value() == net.minecraft.world.item.Items.AIR) return;
                        ItemStack stack = new ItemStack(item.get().value(), 1);
                        stack.setCount(Math.max(1, Math.min(stack.getMaxStackSize(), integer(json, "c"))));
                        f.creativeSet(slot, stack);
                    }
                    s.invDirty = true;
                }
                case "items" -> sendItemList(s);
                case "resync" -> resync(s);
                case "pack_upload" -> uploadPack(s, p, str(json, "zip"));
                case "respawn" -> {
                    if (p.isDeadOrDying()) f.respawn();
                    s.statsDirty = true;
                }
                case "chat" -> {
                    String msg = str(json, "msg");
                    if (msg == null) return;
                    msg = msg.strip().replaceAll("\\p{Cntrl}", "");
                    if (msg.isEmpty()) return;
                    if (msg.length() > 256) msg = msg.substring(0, 256);
                    chat(p, msg);
                }
                default -> { }
            }
        } catch (Exception e) {
            logger.log(java.util.logging.Level.WARNING, "WebCraft: action '" + type + "' of " + s.name + " failed", e);
        }
    }

    /** Chat line or /command from the browser, like a Minecraft client would send it. */
    private void chat(ServerPlayer p, String msg) {
        if (msg.startsWith("/")) {
            server.getCommands().performPrefixedCommand(p.createCommandSourceStack(), msg.substring(1));
            return;
        }
        // Browsers have no chat signing keys: an unsigned message, like on servers without secure chat
        server.getPlayerList().broadcastChatMessage(PlayerChatMessage.unsigned(p.getUUID(), msg), p, ChatType.bind(ChatType.CHAT, p));
    }

    /** A skin picture for the browser (downloaded once, then from config/webcraft/skins/). */
    private void sendSkin(WcSession s, String hash) {
        if (hash == null || s.skinsAsked.size() > 200 || !s.skinsAsked.add(hash)) return;
        java.util.concurrent.CompletableFuture.runAsync(() -> s.send(skins.message(hash, skins.picture(hash))));
    }

    private void login(WcSession s, String rawName) {
        if (rawName == null || !NAME_PATTERN.matcher(rawName).matches()) {
            fail(s, "Name must be 3-13 characters: letters, digits or _");
            return;
        }
        String fullName = namePrefix + rawName;
        // Same WebCraft name logged in again (second tab, or the old connection died without closing):
        // like Minecraft, the new login wins and the old one is closed.
        WcSession old = findSession(fullName);
        if (old != null) {
            old.kicked("Du hast dich woanders mit diesem Namen eingeloggt.");
            handleDisconnect(old);
        }
        if (sessions.size() >= maxPlayers) {
            fail(s, "WebCraft is full right now, try again later");
            return;
        }
        PlayerList players = server.getPlayerList();
        if (players.getPlayerByName(fullName) != null) {
            fail(s, "Name is already in use");
            return;
        }
        NameAndId id = new NameAndId(WcFakePlayer.uuidFor(fullName), fullName);
        if (players.getBans().isBanned(id)) {
            fail(s, "You are banned from this server");
            return;
        }
        if (players.isUsingWhitelist() && !players.isWhiteListed(id)) {
            fail(s, "Not on the whitelist. Ask an admin: /webcraft whitelist " + rawName);
            return;
        }

        s.name = fullName;
        try {
            s.fake = WcFakePlayer.join(this, s, fullName, joinLevel(), s.conn.getRemoteSocketAddress());
        } catch (Exception e) {
            logger.log(java.util.logging.Level.SEVERE, "WebCraft: could not create player " + fullName, e);
            fail(s, "Server error while joining, see server log");
            return;
        }
        ServerPlayer p = s.fake.handle();
        sessions.put(s.id, s);
        byPlayer.put(p.getUUID(), s);
        if (!validLocation(p)) {
            // Broken saved position: back to the world spawn on solid ground
            ServerLevel l = server.overworld();
            BlockPos spawn = server.getRespawnData().pos();
            l.getChunk(spawn.getX() >> 4, spawn.getZ() >> 4);
            int y = l.getHeight(Heightmap.Types.MOTION_BLOCKING, spawn.getX(), spawn.getZ());
            p.teleportTo(l, spawn.getX() + 0.5, y, spawn.getZ() + 0.5, Set.<Relative>of(), 0f, 0f, true);
        }
        freeFromBlocks(p);

        ServerLevel level = p.level();
        s.worldName = worldId(level);
        JsonObject welcome = new JsonObject();
        welcome.addProperty("t", "welcome");
        welcome.addProperty("name", fullName);
        welcome.addProperty("entityId", p.getId());
        addWorld(welcome, level);
        welcome.addProperty("viewDistance", viewDistance);
        addPos(welcome, p);
        s.send(welcome);
        JsonObject pack = textures.message();
        if (pack != null) s.send(pack);
        sendItemList(s);
        s.invDirty = true;
        s.statsDirty = true;
        updateChunks(s, true);
        logger.info(fullName + " joined via WebCraft from " + s.conn.getRemoteSocketAddress());
    }

    private void fail(WcSession s, String message) {
        JsonObject err = new JsonObject();
        err.addProperty("t", "error");
        err.addProperty("msg", message);
        s.send(err);
        s.conn.close(1000, message);
    }

    @Override
    public void handleDisconnect(WcSession s) {
        if (s.name == null || sessions.remove(s.id) == null) return;
        if (s.fake != null) {
            byPlayer.values().remove(s);
            if (!s.fake.isRemoved()) s.fake.remove();
        }
        logger.info(s.name + " left WebCraft");
    }

    /** Saved position inside blocks (e.g. after a lag correction): move up to the next free space. */
    private static void freeFromBlocks(ServerPlayer sp) {
        if (sp.level().noCollision(sp, sp.getBoundingBox().deflate(1.0E-3))) return;
        for (int dy = 1; dy <= 64; dy++) {
            double y = Math.floor(sp.getY()) + dy;
            if (y + 2 > sp.level().getMinY() + sp.level().getHeight()) break;
            AABB box = sp.getBoundingBox().move(0, y - sp.getY(), 0).deflate(1.0E-3);
            if (sp.level().noCollision(sp, box)) {
                sp.teleportTo(sp.level(), sp.getX(), y, sp.getZ(), Set.<Relative>of(), sp.getYRot(), sp.getXRot(), true);
                return;
            }
        }
    }

    private static boolean validLocation(ServerPlayer p) {
        return Double.isFinite(p.getX()) && Double.isFinite(p.getY()) && Double.isFinite(p.getZ())
                && Float.isFinite(p.getYRot()) && Float.isFinite(p.getXRot()) && Math.abs(p.getX()) < 3e7 && Math.abs(p.getZ()) < 3e7;
    }

    private static int digTicks(ServerPlayer p, int x, int y, int z) {
        BlockPos pos = new BlockPos(x, y, z);
        BlockState b = p.level().getBlockState(pos);
        GameType mode = p.gameMode();
        float hardness = b.getDestroySpeed(p.level(), pos);
        if (b.isAir() || b.liquid()) return -1;
        if (mode == GameType.CREATIVE) return 0;
        if (hardness < 0 || mode == GameType.ADVENTURE || mode == GameType.SPECTATOR) return -1;
        float perTick = b.getDestroyProgress(p, p.level(), pos);
        return perTick >= 1f ? 0 : perTick <= 0f ? -1 : (int) Math.ceil(1f / perTick);
    }

    private void sendDigInfo(WcSession s, int x, int y, int z, int ticks) {
        JsonObject msg = new JsonObject();
        msg.addProperty("t", "dig_info");
        msg.addProperty("x", x);
        msg.addProperty("y", y);
        msg.addProperty("z", z);
        msg.addProperty("ticks", ticks);
        s.send(msg);
    }

    // ------------------------------------------------------------------ per-tick work

    private void tick() {
        if (server == null) return;
        tickCounter++;
        runLater();
        if (sessions.isEmpty()) {
            pendingBlocks.clear();
            return;
        }
        for (WcSession s : sessions.values()) {
            if (s.closed || s.fake == null || s.fake.isRemoved()) continue;
            s.fake.tick();
            if (s.fake.isRemoved()) continue;
            ServerPlayer p = s.fake.handle();
            if (!worldId(p.level()).equals(s.worldName)) changeWorld(s, p);
            updateChunks(s, false);
            sendQueuedChunks(s);
            if (s.invDirty) {
                s.invDirty = false;
                sendInventory(s, p);
            }
            if (!s.blockChanges.isEmpty()) {
                JsonArray list = new JsonArray();
                Object[] c;
                int n = 0;
                while ((c = s.blockChanges.poll()) != null && n++ < 4096) {
                    BlockPos pos = (BlockPos) c[0];
                    JsonArray entry = new JsonArray();
                    entry.add(pos.getX());
                    entry.add(pos.getY());
                    entry.add(pos.getZ());
                    entry.add(palette.idOf((BlockState) c[1]));
                    list.add(entry);
                }
                JsonObject m = new JsonObject();
                m.addProperty("t", "blocks");
                m.add("list", list);
                s.sendWithPalette(palette, m);
            }
            if (!s.anims.isEmpty()) {
                JsonArray list = new JsonArray();
                int[] a;
                Set<Long> seen = new HashSet<>();
                while ((a = s.anims.poll()) != null) {
                    if (!seen.add(((long) a[0] << 8) | a[1])) continue;   // one per entity and kind
                    JsonArray e = new JsonArray();
                    e.add(a[0]);
                    e.add(a[1]);
                    list.add(e);
                }
                JsonObject m = new JsonObject();
                m.addProperty("t", "anim");
                m.add("l", list);
                s.send(m);
            }
            JsonObject fx = WcParticles.take(s.fx, palette);
            if (fx != null) s.sendWithPalette(palette, fx);
            JsonObject board = s.scoreboard.takeUpdate();
            if (board != null) s.send(board);
            if (s.statsDirty || tickCounter % 10 == 0) {
                s.statsDirty = false;
                sendStats(s, p);
            }
            if (tickCounter % 20 == 0) {
                // World clock for the day/night sky; the browser runs it on between these messages
                JsonObject m = new JsonObject();
                m.addProperty("t", "time");
                m.addProperty("v", p.level().getDefaultClockTime());
                WcWeather.addTo(m, p);
                s.send(m);
            }
        }
        if (!pendingBlocks.isEmpty()) flushBlockChanges();
        if (tickCounter % 2 == 0) sendEntities();
        if (tickCounter % 20 == 0) sendTabLists();
    }

    private void later(long delayTicks, Runnable task) {
        later.add(new Later(tickCounter + delayTicks, task));
    }

    private void runLater() {
        if (later.isEmpty()) return;
        List<Later> due = new ArrayList<>();
        later.removeIf(l -> {
            if (l.tick() > tickCounter) return false;
            due.add(l);
            return true;
        });
        for (Later l : due) l.task().run();
    }

    private void changeWorld(WcSession s, ServerPlayer p) {
        ServerLevel level = p.level();
        s.worldName = worldId(level);
        s.sentChunks.clear();
        s.loading.clear();
        s.chunkQueue.clear();
        JsonObject m = new JsonObject();
        m.addProperty("t", "world");
        addWorld(m, level);
        addPos(m, p);
        s.send(m);
        updateChunks(s, true);
    }

    private static String worldId(Level level) {
        return level.dimension().identifier().toString();
    }

    private static void addWorld(JsonObject m, ServerLevel level) {
        m.addProperty("world", worldId(level));
        m.addProperty("minY", level.getMinY());
        m.addProperty("maxY", level.getMinY() + level.getHeight());
        String env = level.dimension() == Level.NETHER ? "NETHER" : level.dimension() == Level.END ? "THE_END" : "NORMAL";
        m.addProperty("env", env);
        addBorder(m, level);
    }

    private void sendStats(WcSession s, ServerPlayer p) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "stats");
        m.addProperty("hp", round(p.getHealth()));
        m.addProperty("max", round(p.getMaxHealth()));
        m.addProperty("food", p.getFoodData().getFoodLevel());
        m.addProperty("armor", p.getArmorValue());
        m.addProperty("lvl", p.experienceLevel);
        m.addProperty("xp", round(p.experienceProgress));
        m.addProperty("air", p.getAirSupply());
        m.addProperty("maxAir", p.getMaxAirSupply());
        m.addProperty("fly", p.getAbilities().mayfly);
        m.addProperty("gm", p.gameMode().name());
        m.addProperty("as", round(p.getAttributeValue(Attributes.ATTACK_SPEED)));
        addBorder(m, p.level());   // the border can move
        m.addProperty("dead", p.isDeadOrDying());
        String key = m.toString();
        if (key.equals(s.lastStats)) return;
        s.lastStats = key;
        s.send(m);
    }

    private void sendInventory(WcSession s, ServerPlayer p) {
        // Hotbar for the HUD
        var inv = p.getInventory();
        JsonObject hud = new JsonObject();
        hud.addProperty("t", "inv");
        JsonArray hot = new JsonArray();
        for (int i = 0; i < 9; i++) hot.add(WcItems.json(inv.getItem(i)));
        hud.add("hot", hot);
        hud.add("off", WcItems.json(p.getOffhandItem()));
        hud.addProperty("sel", inv.getSelectedSlot());
        s.send(hud);

        // The open screen (own inventory, chest, workbench, mod GUI ...)
        boolean container = s.fake.containerOpen();
        if (container || s.screenOpen) {
            WcFakePlayer.MenuSnapshot snap = s.fake.snapshotMenu();
            JsonObject menu = new JsonObject();
            menu.addProperty("t", "menu");
            menu.addProperty("open", true);
            menu.addProperty("id", snap.id());
            menu.addProperty("type", snap.type());
            menu.addProperty("title", snap.title());
            JsonArray slots = new JsonArray();
            for (ItemStack it : snap.slots()) slots.add(WcItems.json(it));
            menu.add("slots", slots);
            menu.add("carried", WcItems.json(snap.carried()));
            // Progress bars, fuel, enchanting costs ... and the trades of a villager
            JsonArray data = new JsonArray();
            for (int v : s.fake.menuData()) data.add(v);
            menu.add("data", data);
            JsonObject trades = s.fake.tradesJson();
            if (trades != null) menu.add("trades", trades);
            s.send(menu);
            s.screenOpen = true;
            s.sentContainer = container;
        } else if (s.sentContainer) {
            // The server closed the container
            JsonObject menu = new JsonObject();
            menu.addProperty("t", "menu");
            menu.addProperty("open", false);
            s.send(menu);
            s.sentContainer = false;
        }
    }

    // ------------------------------------------------------------------ chunk streaming

    private void updateChunks(WcSession s, boolean force) {
        ServerPlayer p = s.fake.handle();
        int cx = p.getBlockX() >> 4;
        int cz = p.getBlockZ() >> 4;
        if (!force && cx == s.centerChunkX && cz == s.centerChunkZ) return;
        s.centerChunkX = cx;
        s.centerChunkZ = cz;

        int keep = viewDistance + 1;
        List<Long> toUnload = new ArrayList<>();
        for (long key : s.sentChunks) {
            int dx = WcSession.keyX(key) - cx, dz = WcSession.keyZ(key) - cz;
            if (dx * dx + dz * dz > keep * keep) toUnload.add(key);
        }
        if (!toUnload.isEmpty()) {
            JsonArray list = new JsonArray();
            for (long key : toUnload) {
                s.sentChunks.remove(key);
                JsonArray pair = new JsonArray();
                pair.add(WcSession.keyX(key));
                pair.add(WcSession.keyZ(key));
                list.add(pair);
            }
            JsonObject msg = new JsonObject();
            msg.addProperty("t", "unload");
            msg.add("list", list);
            s.send(msg);
        }

        List<long[]> wanted = new ArrayList<>();
        int r = viewDistance;
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                int d2 = dx * dx + dz * dz;
                if (d2 > r * r + r) continue;
                long key = WcSession.key(cx + dx, cz + dz);
                if (!s.sentChunks.contains(key)) wanted.add(new long[]{d2, key});
            }
        }
        wanted.sort(Comparator.comparingLong(a -> a[0]));
        s.chunkQueue.clear();
        for (long[] w : wanted) s.chunkQueue.add(w[1]);
    }

    private static final long CHUNK_TIMEOUT_MS = 15000;

    private void sendQueuedChunks(WcSession s) {
        ServerLevel level = s.fake.handle().level();
        String worldAtStart = worldId(level);
        long now = System.currentTimeMillis();
        // Slow chunks (generation on a busy server can take long) still arrive later, but after
        // CHUNK_TIMEOUT_MS they no longer block the next ones, so loading never stops completely.
        int fresh = 0;
        for (long started : s.loading.values()) if (now - started < CHUNK_TIMEOUT_MS) fresh++;
        int budget = chunksPerTick;
        int limit = chunksPerTick * 3;
        while (budget > 0 && fresh + s.inFlight.get() < limit && !s.chunkQueue.isEmpty()) {
            long key = s.chunkQueue.poll();
            if (!s.sentChunks.add(key)) continue;
            budget--;
            int cx = WcSession.keyX(key), cz = WcSession.keyZ(key);
            // Outside the world border: send an empty chunk. Without it the browser waits forever for the
            // neighbours of the last real chunks and never shows them ("world does not load" at the border).
            if (outsideBorder(level, cx, cz)) {
                sendEmptyChunk(s, cx, cz);
                continue;
            }
            s.loading.put(key, now);
            fresh++;
            var future = level.getChunkSource().getChunkFuture(cx, cz, ChunkStatus.FULL, true);
            future.whenComplete((result, err) -> runSync(() -> {
                s.loading.remove(key);
                if (s.closed) return;
                ChunkAccess chunk = err == null && result != null ? result.orElse(null) : null;
                if (chunk == null) {
                    // Could not be loaded (e.g. generation failed): show it as empty
                    sendEmptyChunk(s, cx, cz);
                    return;
                }
                if (!worldAtStart.equals(s.worldName)) return;
                if (!s.sentChunks.contains(key)) return;       // not wanted any more (walked away)
                List<ChunkEncoder.Section> sections;
                try {
                    sections = ChunkEncoder.copy(chunk);
                } catch (RuntimeException ex) {
                    logger.log(java.util.logging.Level.WARNING, "Could not read chunk " + cx + "," + cz, ex);
                    s.sentChunks.remove(key);
                    return;
                }
                s.inFlight.incrementAndGet();
                encoder.execute(() -> {
                    try {
                        if (!s.closed) s.sendWithPalette(palette, ChunkEncoder.encode(cx, cz, sections, palette));
                    } catch (Exception e) {
                        logger.log(java.util.logging.Level.WARNING, "Could not encode chunk " + cx + "," + cz, e);
                    } finally {
                        s.inFlight.decrementAndGet();
                    }
                });
            }));
        }
    }

    /** The browser misses chunks around the player: send everything around it again. */
    private void resync(WcSession s) {
        s.sentChunks.clear();
        s.loading.clear();
        s.chunkQueue.clear();
        updateChunks(s, true);
    }

    private void sendEmptyChunk(WcSession s, int cx, int cz) {
        s.inFlight.incrementAndGet();
        encoder.execute(() -> {
            try {
                if (!s.closed) s.sendWithPalette(palette, ChunkEncoder.encode(cx, cz, List.of(), palette));
            } catch (Exception e) {
                logger.log(java.util.logging.Level.WARNING, "Could not encode empty chunk " + cx + "," + cz, e);
            } finally {
                s.inFlight.decrementAndGet();
            }
        });
    }

    /** True if the whole chunk lies outside the world border. */
    private static boolean outsideBorder(ServerLevel level, int cx, int cz) {
        WorldBorder border = level.getWorldBorder();
        double half = border.getSize() / 2;
        double x0 = cx * 16, z0 = cz * 16;
        return x0 + 16 <= border.getCenterX() - half || x0 >= border.getCenterX() + half
                || z0 + 16 <= border.getCenterZ() - half || z0 >= border.getCenterZ() + half;
    }

    /** World border for the browser (shown as a wall, you can't walk through it). */
    private static void addBorder(JsonObject o, ServerLevel level) {
        WorldBorder border = level.getWorldBorder();
        JsonObject b = new JsonObject();
        b.addProperty("x", border.getCenterX());
        b.addProperty("z", border.getCenterZ());
        b.addProperty("size", Math.min(border.getSize(), 6.0e7));
        o.add("border", b);
    }

    // ------------------------------------------------------------------ block updates

    private void queueBlockCheck(ResourceKey<Level> dim, int x, int y, int z) {
        if (sessions.isEmpty() || pendingBlocks.size() >= MAX_PENDING_BLOCKS) return;
        pendingBlocks.add(new BlockAt(dim, x, y, z));
    }

    /**
     * The browser shows placing and breaking right away. Send the real blocks around the spot a little
     * later, so a refused action (protection mod, not done yet ...) is corrected on the screen.
     */
    private void confirmBlocks(ResourceKey<Level> dim, int x, int y, int z) {
        for (long delay : new long[] {3L, 20L, 70L}) {
            later(delay, () -> {
                queueBlockCheck(dim, x, y, z);
                queueBlockCheck(dim, x + 1, y, z);
                queueBlockCheck(dim, x - 1, y, z);
                queueBlockCheck(dim, x, y + 1, z);
                queueBlockCheck(dim, x, y - 1, z);
                queueBlockCheck(dim, x, y, z + 1);
                queueBlockCheck(dim, x, y, z - 1);
            });
        }
    }

    private void logBlock(ServerPlayer p, String action, BlockPos pos, BlockState state) {
        if (!logBlocks || !byPlayer.containsKey(p.getUUID())) return;
        blockLog.log(p.getGameProfile().name(), action, worldId(p.level()), pos.getX(), pos.getY(), pos.getZ(),
                BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath());
    }

    private void flushBlockChanges() {
        Map<WcSession, JsonArray> perSession = new HashMap<>();
        for (BlockAt pos : pendingBlocks) {
            ServerLevel level = server.getLevel(pos.dim());
            if (level == null) continue;
            int cx = pos.x() >> 4, cz = pos.z() >> 4;
            if (!level.hasChunk(cx, cz)) continue;
            int id = palette.idOf(level.getBlockState(new BlockPos(pos.x(), pos.y(), pos.z())));
            long key = WcSession.key(cx, cz);
            String world = pos.dim().identifier().toString();
            for (WcSession s : sessions.values()) {
                if (!world.equals(s.worldName) || !s.sentChunks.contains(key)) continue;
                JsonArray entry = new JsonArray();
                entry.add(pos.x());
                entry.add(pos.y());
                entry.add(pos.z());
                entry.add(id);
                perSession.computeIfAbsent(s, k -> new JsonArray()).add(entry);
            }
        }
        pendingBlocks.clear();
        perSession.forEach((s, list) -> {
            JsonObject msg = new JsonObject();
            msg.addProperty("t", "blocks");
            msg.add("list", list);
            s.sendWithPalette(palette, msg);
        });
    }

    // ------------------------------------------------------------------ entities around each WebCraft player

    private void sendEntities() {
        for (WcSession s : sessions.values()) {
            if (s.closed || s.fake == null || s.fake.isRemoved()) continue;
            ServerPlayer self = s.fake.handle();
            Vec3 center = self.position();
            List<Entity> near = new ArrayList<>(self.level().getEntities(self, new AABB(center, center).inflate(entityRange),
                    WcMod::shown));
            // Players, holograms and falling blocks first, then everything else by distance
            near.sort(Comparator.comparingInt(WcMod::priority).thenComparingDouble(e -> e.distanceToSqr(center)));
            JsonArray list = new JsonArray();
            int n = 0;
            for (Entity e : near) {
                if (n >= MAX_ENTITIES) break;
                if (e instanceof ServerPlayer other && other.isSpectator()) continue;
                JsonObject json = entityJson(e);
                if (json == null) continue;
                list.add(json);
                n++;
            }
            // Holograms that only exist as packets
            double r2 = entityRange * entityRange;
            for (WcSession.Virtual v : s.virtualEntities.values()) {
                if (v.text == null || v.text.isBlank()) continue;
                double dx = v.x - center.x, dy = v.y - center.y, dz = v.z - center.z;
                if (dx * dx + dy * dy + dz * dz > r2) continue;
                JsonObject o = new JsonObject();
                o.addProperty("i", v.id);
                o.addProperty("type", "label");
                o.addProperty("x", round(v.x));
                o.addProperty("y", round(v.y + (v.type.equals("armor_stand") ? 1.9 : 0)));
                o.addProperty("z", round(v.z));
                o.addProperty("txt", v.text);
                list.add(o);
            }
            JsonObject msg = new JsonObject();
            msg.addProperty("t", "ents");
            msg.add("list", list);
            s.sendWithPalette(palette, msg);
        }
    }

    private static int priority(Entity e) {
        if (e instanceof Player || e instanceof Display || e instanceof FallingBlockEntity || e instanceof Projectile) return 0;
        if (e.getCustomName() != null && e.isCustomNameVisible()) return 0;
        if (e instanceof ItemEntity) return 2;
        return 1;
    }

    private static boolean shown(Entity e) {
        return e instanceof LivingEntity || e instanceof ItemEntity || e instanceof FallingBlockEntity
                || e instanceof Display || e instanceof VehicleEntity || e instanceof Projectile
                || e instanceof net.minecraft.world.entity.LightningBolt;
    }

    /** Names the browser knows from the Paper plugin (Bukkit enum names) where Minecraft's differ. */
    private static final Map<String, String> VARIANT_NAMES = Map.of(
            "red_blue", "red", "yellow_blue", "cyan",                                  // parrots
            "white_splotched", "black_and_white", "salt", "salt_and_pepper", "evil", "the_killer_bunny");  // rabbits

    /** The look of a mob type that has several (cat/wolf/frog/cow ... keys, horse colors, villager jobs). */
    private static String variantOf(Entity e) {
        try {
            if (e instanceof net.minecraft.world.entity.npc.villager.Villager v) return holderName(v.getVillagerData().profession());
            if (e instanceof net.minecraft.world.entity.monster.zombie.ZombieVillager v) return holderName(v.getVillagerData().profession());
            if (e instanceof net.minecraft.world.entity.animal.fish.TropicalFish t) return t.getPattern().name().toLowerCase();
            java.lang.reflect.Method m = findMethod(e.getClass(), "getVariant");
            if (m == null) return null;
            Object v = m.invoke(e);
            String name = null;
            if (v instanceof Holder<?> h) name = holderName(h);
            else if (v instanceof StringRepresentable sr) name = sr.getSerializedName();
            else if (v instanceof Enum<?> en) name = en.name().toLowerCase();
            return name == null ? null : VARIANT_NAMES.getOrDefault(name, name);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String holderName(Holder<?> h) {
        return h.unwrapKey().map(k -> k.identifier().getPath()).orElse(null);
    }

    private static java.lang.reflect.Method findMethod(Class<?> c, String name) {
        for (; c != null && c != Object.class; c = c.getSuperclass()) {
            try {
                java.lang.reflect.Method m = c.getDeclaredMethod(name);
                m.setAccessible(true);
                return m;
            } catch (NoSuchMethodException ignored) {
            }
        }
        return null;
    }

    /** Calls a private getter of the display entities (text, block, item, transformation). */
    private static Object call(Object target, Class<?> owner, String method) {
        try {
            java.lang.reflect.Method m = owner.getDeclaredMethod(method);
            m.setAccessible(true);
            return m.invoke(target);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    private static String itemKey(ItemStack s) {
        return s == null || s.isEmpty() ? null : WcItems.key(s);
    }

    private JsonObject entityJson(Entity e) {
        JsonObject o = new JsonObject();
        o.addProperty("i", e.getId());
        o.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).getPath());
        String name = e.getCustomName() != null && e.isCustomNameVisible() ? e.getCustomName().getString() : null;
        Vec3 l = e.position();
        // Invisible entities only show up as their name tag (classic armor-stand holograms)
        if (e instanceof LivingEntity le && le.isInvisible() && !(e instanceof Player)) {
            if (name == null || name.isBlank()) return null;
            o.addProperty("type", "label");
            o.addProperty("txt", name);
            o.addProperty("x", round(l.x));
            o.addProperty("y", round(l.y + e.getBbHeight()));
            o.addProperty("z", round(l.z));
            return o;
        }
        o.addProperty("x", round(l.x));
        o.addProperty("y", round(l.y));
        o.addProperty("z", round(l.z));
        AABB bb = e.getBoundingBox();
        o.addProperty("w", round(bb.getXsize()));
        o.addProperty("h", round(bb.getYsize()));
        if (e instanceof ItemEntity item) {
            o.addProperty("k", WcItems.key(item.getItem()));
            return o;
        }
        if (e instanceof Projectile) {
            // Thrown things (wind charge, snowball, pearl, potion ...) look like their item; arrows have a direction
            String k = e instanceof ItemSupplier is ? itemKey(is.getItem()) : null;
            if (k == null) {
                String type = o.get("type").getAsString();
                k = switch (type) {
                    case "trident" -> "trident";
                    case "wind_charge", "breeze_wind_charge" -> "wind_charge";
                    case "fireball", "small_fireball", "dragon_fireball" -> "fire_charge";
                    default -> null;
                };
            }
            if (k != null) o.addProperty("k", k);
            Vec3 v = e.getDeltaMovement();
            o.addProperty("vx", round(v.x));
            o.addProperty("vy", round(v.y));
            o.addProperty("vz", round(v.z));
            o.addProperty("proj", true);
            return o;
        }
        if (e instanceof FallingBlockEntity fb) {
            o.addProperty("b", palette.idOf(fb.getBlockState()));
            return o;
        }
        if (e instanceof Display d) {
            Object tr = transformation(d);
            if (tr instanceof com.mojang.math.Transformation t) {
                o.addProperty("sx", round(t.scale().x()));
                o.addProperty("sy", round(t.scale().y()));
                o.addProperty("sz", round(t.scale().z()));
                o.addProperty("tx", round(t.translation().x()));
                o.addProperty("ty", round(t.translation().y()));
                o.addProperty("tz", round(t.translation().z()));
            }
            if (d instanceof Display.TextDisplay td) {
                Object text = call(td, Display.TextDisplay.class, "getText");
                String plain = text instanceof Component c ? c.getString() : null;
                if (plain == null || plain.isBlank()) return null;
                o.addProperty("txt", plain);
            } else if (d instanceof Display.BlockDisplay bd) {
                Object state = call(bd, Display.BlockDisplay.class, "getBlockState");
                if (!(state instanceof BlockState bs)) return null;
                o.addProperty("b", palette.idOf(bs));
            } else if (d instanceof Display.ItemDisplay id) {
                Object stack = call(id, Display.ItemDisplay.class, "getItemStack");
                String k = stack instanceof ItemStack is ? itemKey(is) : null;
                if (k == null) return null;
                o.addProperty("k", k);
            } else {
                return null;
            }
            o.addProperty("yaw", round(e.getYRot()));
            return o;
        }
        o.addProperty("yaw", round(e.getYRot()));
        o.addProperty("pitch", round(e.getXRot()));
        if (e instanceof LivingEntity le) {
            o.addProperty("body", round(le.yBodyRot));
            if (le.hurtTime > 0) o.addProperty("hurt", true);
            if (le.isDeadOrDying()) o.addProperty("dead", true);
            if (le.isUsingItem()) o.addProperty("use", true);   // eating, drinking, drawing a bow ...
            String variant = variantOf(e);
            if (variant != null) o.addProperty("var", variant);
            if (e instanceof Sheep sheep) {
                o.addProperty("col", sheep.getColor().getTextureDiffuseColor() & 0xFFFFFF);
                if (sheep.isSheared()) o.addProperty("sheared", true);
            }
            if (e instanceof net.minecraft.world.entity.animal.fish.TropicalFish fish) {
                o.addProperty("col", fish.getBaseColor().getTextureDiffuseColor() & 0xFFFFFF);
                o.addProperty("col2", fish.getPatternColor().getTextureDiffuseColor() & 0xFFFFFF);
            }
            if (le.isBaby()) o.addProperty("baby", true);
            String hand = itemKey(le.getItemBySlot(EquipmentSlot.MAINHAND));
            if (hand != null) o.addProperty("hand", hand);
            // Armor, so you can see who is wearing what
            EquipmentSlot[] armor = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
            JsonArray arm = new JsonArray();
            boolean any = false;
            for (EquipmentSlot slot : armor) {
                String k = itemKey(le.getItemBySlot(slot));
                if (k == null) arm.add(com.google.gson.JsonNull.INSTANCE);
                else {
                    arm.add(k);
                    any = true;
                }
            }
            if (any) o.add("arm", arm);
        }
        if (e instanceof Player p) {
            o.addProperty("n", p.getGameProfile().name());
            skins.addTo(o, p.getGameProfile());
            if (byPlayer.containsKey(p.getUUID())) o.addProperty("wc", true);
            if (p.isShiftKeyDown()) o.addProperty("sn", true);
            if (p.isSwimming()) o.addProperty("sw", true);
        } else if (name != null) {
            o.addProperty("n", name);
        }
        return o;
    }

    private static Object transformation(Display d) {
        try {
            java.lang.reflect.Method m = Display.class.getDeclaredMethod("createTransformation", net.minecraft.network.syncher.SynchedEntityData.class);
            m.setAccessible(true);
            return m.invoke(null, d.getEntityData());
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ texture pack

    /** An admin uploads a pack from the texture studio: save it and give it to every WebCraft player. */
    private void uploadPack(WcSession s, ServerPlayer p, String base64) {
        if (!p.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER)) {
            s.notice("Nur Admins (OP) dürfen Texturen für alle hochladen");
            return;
        }
        try {
            int count = textures.save(Base64.getDecoder().decode(base64 == null ? "" : base64));
            JsonObject pack = textures.message();
            JsonObject empty = new JsonObject();
            empty.addProperty("t", "pack");
            empty.add("files", new JsonObject());
            for (WcSession other : sessions.values()) {
                if (other.name != null) other.send(pack != null ? pack : empty);
            }
            s.notice(count + " Texturen für alle gespeichert");
            logger.info(s.name + " uploaded a texture pack with " + count + " textures");
        } catch (IOException | IllegalArgumentException e) {
            s.notice("Texturen konnten nicht gespeichert werden: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------------ creative item list

    private JsonObject itemList;

    private void sendItemList(WcSession s) {
        if (itemList == null) {
            JsonArray keys = new JsonArray();
            JsonArray blocks = new JsonArray();     // block keys (with or without an item form)
            for (Item item : BuiltInRegistries.ITEM) {
                if (item == net.minecraft.world.item.Items.AIR) continue;
                keys.add(BuiltInRegistries.ITEM.getKey(item).getPath());
            }
            for (Block block : BuiltInRegistries.BLOCK) {
                BlockState state = block.defaultBlockState();
                if (state.isAir()) continue;
                blocks.add(BuiltInRegistries.BLOCK.getKey(block).getPath());
                // Make sure the browser knows how the block looks (for item icons)
                palette.idOf(state);
            }
            itemList = new JsonObject();
            itemList.addProperty("t", "items");
            itemList.add("list", keys);
            itemList.add("blocks", blocks);
        }
        s.sendWithPalette(palette, itemList);
    }

    // ------------------------------------------------------------------ tab list (all players on the server)

    private void sendTabLists() {
        List<ServerPlayer> online = new ArrayList<>(server.getPlayerList().getPlayers());
        online.sort(Comparator.comparing(p -> p.getGameProfile().name().toLowerCase()));
        for (WcSession s : sessions.values()) {
            if (s.closed || s.fake == null || s.fake.isRemoved()) continue;
            JsonArray list = new JsonArray();
            for (ServerPlayer p : online) {
                JsonObject o = new JsonObject();
                String name = p.getGameProfile().name();
                o.addProperty("n", name);
                Component shown = p.getTabListDisplayName();
                if (shown != null && !shown.getString().equals(name)) o.addProperty("d", shown.getString());
                if (byPlayer.containsKey(p.getUUID())) o.addProperty("wc", true);
                else o.addProperty("ping", p.connection.latency());
                if (p.isSpectator()) o.addProperty("spec", true);
                list.add(o);
            }
            JsonObject msg = new JsonObject();
            msg.addProperty("t", "tab");
            msg.add("players", list);
            msg.addProperty("header", s.tabHeader);
            msg.addProperty("footer", s.tabFooter);
            msg.addProperty("max", server.getPlayerList().getMaxPlayers());
            String key = msg.toString();
            if (key.equals(s.lastTab)) continue;
            s.lastTab = key;
            s.send(msg);
        }
    }

    // ------------------------------------------------------------------ /webcraft command (also /wc)

    private void registerCommands(CommandDispatcher<CommandSourceStack> dispatcher) {
        for (String root : new String[] {"webcraft", "wc"}) {
            dispatcher.register(Commands.literal(root)
                    .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
                    .executes(this::status)
                    .then(Commands.literal("status").executes(this::status))
                    .then(Commands.literal("reload").executes(this::reload))
                    .then(Commands.literal("kick")
                            .then(Commands.argument("name", StringArgumentType.word()).executes(this::kick)))
                    .then(Commands.literal("whitelist")
                            .then(Commands.argument("name", StringArgumentType.word()).executes(this::whitelist))));
        }
    }

    private int status(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        src.sendSystemMessage(Component.literal("WebCraft bridge on port " + port + ", "
                + sessions.size() + "/" + maxPlayers + " WebCraft players").withStyle(ChatFormatting.GOLD));
        for (WcSession s : sessions.values()) {
            if (s.fake == null || s.fake.isRemoved()) continue;
            ServerPlayer p = s.fake.handle();
            String info = (p.isDeadOrDying() ? " (dead)" : "") + " (WebCraft chunks " + s.sentChunks.size() + ", loading " + s.loading.size()
                    + ", queue " + s.chunkQueue.size() + "; " + s.fake.chunkLoaderInfo() + ", " + s.fake.trackingInfo() + ")";
            src.sendSystemMessage(Component.literal(" - " + s.name + " at " + p.getBlockX() + " " + p.getBlockY() + " "
                    + p.getBlockZ() + info).withStyle(ChatFormatting.GRAY));
        }
        return 1;
    }

    private int kick(CommandContext<CommandSourceStack> ctx) {
        String name = StringArgumentType.getString(ctx, "name");
        WcSession s = findSession(name);
        if (s == null) s = findSession(namePrefix + name);
        if (s == null || s.fake == null) {
            ctx.getSource().sendFailure(Component.literal("No WebCraft player with that name"));
            return 0;
        }
        s.fake.kick("Kicked by an admin");
        ctx.getSource().sendSystemMessage(Component.literal("Kicked " + s.name).withStyle(ChatFormatting.GREEN));
        return 1;
    }

    /**
     * Vanilla's /whitelist add asks Mojang for the name, and WebCraft names don't exist there (online-mode
     * servers). This adds the WebCraft player directly, with the same id it gets when joining.
     */
    private int whitelist(CommandContext<CommandSourceStack> ctx) {
        String name = StringArgumentType.getString(ctx, "name");
        String fullName = name.startsWith(namePrefix) ? name : namePrefix + name;
        NameAndId id = new NameAndId(WcFakePlayer.uuidFor(fullName), fullName);
        var list = server.getPlayerList().getWhiteList();
        list.add(new net.minecraft.server.players.UserWhiteListEntry(id));
        try {
            list.save();
        } catch (IOException e) {
            logger.log(java.util.logging.Level.WARNING, "Could not save the whitelist", e);
        }
        ctx.getSource().sendSystemMessage(Component.literal(fullName + " is on the whitelist now").withStyle(ChatFormatting.GREEN));
        return 1;
    }

    private int reload(CommandContext<CommandSourceStack> ctx) {
        for (WcSession s : new ArrayList<>(sessions.values())) fail(s, "WebCraft is restarting");
        stopSocket();
        loadSettings();
        textures.load();
        startSocket();
        ctx.getSource().sendSystemMessage(Component.literal("WebCraft bridge reloaded (port " + port + ")").withStyle(ChatFormatting.GREEN));
        return 1;
    }

    // ------------------------------------------------------------------ small helpers

    private WcSession findSession(String name) {
        for (WcSession s : sessions.values()) if (s.name != null && s.name.equalsIgnoreCase(name)) return s;
        return null;
    }

    private static void addPos(JsonObject o, ServerPlayer p) {
        o.addProperty("x", round(p.getX()));
        o.addProperty("y", round(p.getY()));
        o.addProperty("z", round(p.getZ()));
        o.addProperty("yaw", round(p.getYRot()));
        o.addProperty("pitch", round(p.getXRot()));
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static String str(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : null;
    }

    private static double num(JsonObject o, String key) {
        JsonElement e = o.get(key);
        try {
            return e != null && e.isJsonPrimitive() ? e.getAsDouble() : Double.NaN;
        } catch (NumberFormatException ex) {
            return Double.NaN;
        }
    }

    private static int integer(JsonObject o, String key) {
        double d = num(o, key);
        return Double.isFinite(d) ? (int) Math.floor(d) : 0;
    }

    private static boolean bool(JsonObject o, String key) {
        JsonElement e = o.get(key);
        try {
            return e != null && e.isJsonPrimitive() && e.getAsBoolean();
        } catch (Exception ex) {
            return false;
        }
    }
}
