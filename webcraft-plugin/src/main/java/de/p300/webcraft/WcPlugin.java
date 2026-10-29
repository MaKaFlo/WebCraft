package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.ChunkSnapshot;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.block.Block;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.BoundingBox;

import java.io.File;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.regex.Pattern;

public final class WcPlugin extends JavaPlugin implements WcHost {

    private static final Pattern NAME_PATTERN = Pattern.compile("^[A-Za-z0-9_]{3,13}$");
    private static final int MAX_PENDING_BLOCKS = 20000;
    private static final int MAX_ENTITIES = 120;

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
    private boolean mojangAssets;
    /** Own worlds for single player, null when switched off in the config. */
    private WcSingle singlePlayer;

    private BlockPalette palette;
    private WcSkins skins;
    private WcLang lang;
    private WcSounds sounds;
    private WcServer server;
    private final Map<Integer, WcSession> sessions = new ConcurrentHashMap<>(); // logged-in sessions
    private final Map<UUID, WcSession> byPlayer = new ConcurrentHashMap<>();
    private final Set<BlockPos> pendingBlocks = new HashSet<>();
    private long tickCounter;
    private WcBlockLog blockLog;

    record BlockPos(String world, int x, int y, int z) {}

    // ------------------------------------------------------------------ lifecycle

    @Override
    public void onEnable() {
        takeOverOldFolder();
        saveDefaultConfig();
        loadSettings();
        palette = new BlockPalette(getLogger());
        textures = new WcTextures(getDataFolder(), getLogger());
        textures.load();
        blockLog = new WcBlockLog(new File(getDataFolder(), "blocklog.csv"), getLogger());
        skins = new WcSkins(new File(getDataFolder(), "skins").toPath(), getLogger());
        WcAssets assets = new WcAssets(new File(getDataFolder(), "assets").toPath(), getLogger());
        lang = new WcLang(assets, mojangAssets);
        sounds = new WcSounds(assets, mojangAssets, new File(getDataFolder(), "sounds.zip").toPath());
        getServer().getPluginManager().registerEvents(new WcListener(this), this);
        if (getConfig().getBoolean("singleplayer", true)) {
            singlePlayer = new WcSingle(this, getConfig().getString("singleplayer-prefix", "sp_"));
            getServer().getPluginManager().registerEvents(singlePlayer, this);
        }
        Bukkit.getScheduler().runTaskTimer(this, this::tick, 1L, 1L);
        startServer();
    }

    @Override
    public void onDisable() {
        stopServer();
        for (WcSession s : new ArrayList<>(sessions.values())) {
            s.closed = true;
            if (s.fake != null) s.fake.remove();
        }
        sessions.clear();
        byPlayer.clear();
    }

    private void loadSettings() {
        reloadConfig();
        host = getConfig().getString("host", "0.0.0.0");
        port = getConfig().getInt("port", 25007);
        worldName = getConfig().getString("world", "");
        namePrefix = getConfig().getString("name-prefix", "wc_");
        maxPlayers = getConfig().getInt("max-players", 10);
        viewDistance = Math.max(2, Math.min(16, getConfig().getInt("view-distance", 6)));
        chunksPerTick = Math.max(1, getConfig().getInt("chunks-per-tick", 3));
        entityRange = getConfig().getDouble("entity-range", 64);
        allowedOrigins = getConfig().getStringList("allowed-origins");
        logBlocks = getConfig().getBoolean("log-blocks", true);
        mojangAssets = getConfig().getBoolean("mojang-assets", false);
    }

    private void startServer() {
        server = new WcServer(this, new InetSocketAddress(host, port), allowedOrigins);
        server.start();
    }

    private void stopServer() {
        if (server == null) return;
        try {
            server.stop(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        server = null;
    }

    public World joinWorld() {
        if (worldName != null && !worldName.isEmpty()) {
            World w = Bukkit.getWorld(worldName);
            if (w != null) return w;
        }
        return Bukkit.getWorlds().get(0);
    }

    // ------------------------------------------------------------------ messages from the browser

    @Override
    public void handleMessage(WcSession s, JsonObject json) {
        if (s.closed) return;
        String type = str(json, "t");
        if (type == null) return;
        if (!s.loggedIn()) {
            if ("hello".equals(type) && s.name == null && !s.helloSeen) {
                s.helloSeen = true;
                login(s, str(json, "name"), str(json, "skin"), "single".equals(str(json, "mode")), bool(json, "creative"));
            }
            else if (s.name == null) s.conn.close(1008, "Login first");
            return;
        }
        if (s.fake.isRemoved()) return;
        WcFakePlayer f = s.fake;
        Player p = f.bukkit();
        try {
            switch (type) {
                case "move" -> {
                    if (p.isDead()) return;
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
                    f.setDigNeed(need);
                    sendDigInfo(s, x, y, z, need);
                }
                case "dig_stop" -> {
                    int x = integer(json, "x"), y = integer(json, "y"), z = integer(json, "z");
                    f.dig("stop", x, y, z, integer(json, "face"));
                    confirmBlocks(p.getWorld(), x, y, z);
                }
                case "dig_abort" -> f.dig("abort", integer(json, "x"), integer(json, "y"), integer(json, "z"), integer(json, "face"));
                case "use_on" -> {
                    int x = integer(json, "x"), y = integer(json, "y"), z = integer(json, "z");
                    f.useOn(x, y, z, integer(json, "face"), num(json, "hx"), num(json, "hy"), num(json, "hz"));
                    confirmBlocks(p.getWorld(), x, y, z);
                }
                case "use" -> f.useItem();
                case "release" -> f.releaseUse();
                case "attack" -> f.attack(integer(json, "id"));
                case "punch" -> f.punch();
                case "interact" -> f.interact(integer(json, "id"), num(json, "hx"), num(json, "hy"), num(json, "hz"));
                case "button" -> { f.menuButton(integer(json, "id")); s.invDirty = true; }
                case "trade" -> { f.selectTrade(integer(json, "i")); s.invDirty = true; }
                case "skin" -> sendSkin(s, str(json, "h"));
                case "lang" -> sendLang(s, str(json, "l"));
                case "sound" -> sounds.ask(s, str(json, "e"));
                case "sfile" -> sounds.askFile(s, str(json, "h"));
                case "beacon" -> { f.beacon(str(json, "p"), str(json, "s")); s.invDirty = true; }
                case "rename" -> { f.rename(str(json, "name")); s.invDirty = true; }
                case "swing" -> p.swingMainHand();   // only the animation (digging), no click event
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
                        org.bukkit.Material m = org.bukkit.Material.matchMaterial(key);
                        if (m == null || !m.isItem() || m.isAir()) return;
                        int count = Math.max(1, Math.min(m.getMaxStackSize(), integer(json, "c")));
                        f.creativeSet(slot, new ItemStack(m, count));
                    }
                    s.invDirty = true;
                }
                case "items" -> sendItemList(s);
                case "resync" -> resync(s);
                case "pack_upload" -> uploadPack(s, f, str(json, "zip"));
                case "respawn" -> {
                    if (p.isDead()) f.respawn();
                    s.statsDirty = true;
                }
                case "chat" -> {
                    String msg = str(json, "msg");
                    if (msg == null) return;
                    msg = msg.strip().replaceAll("\\p{Cntrl}", "");
                    if (msg.isEmpty()) return;
                    if (msg.length() > 256) msg = msg.substring(0, 256);
                    p.chat(msg); // also runs /commands
                }
                default -> { }
            }
        } catch (Exception e) {
            getLogger().log(Level.WARNING, "WebCraft: action '" + type + "' of " + s.name + " failed", e);
        }
    }

    private void login(WcSession s, String rawName, String skinName, boolean single, boolean creative) {
        if (rawName == null || !NAME_PATTERN.matcher(rawName).matches()) {
            fail(s, "Name must be 3-13 characters: letters, digits or _");
            return;
        }
        if (single && singlePlayer == null) {
            fail(s, "Einzelspieler ist auf diesem Server ausgeschaltet");
            return;
        }
        // Creative single player is an own player (own inventory, own world): another name prefix. Survival single
        // player is the normal player on the normal world, only without the others.
        boolean ownWorld = single && creative;
        String fullName = (ownWorld ? singlePlayer.prefix : namePrefix) + rawName;
        String accountName = namePrefix + rawName;   // bans and the whitelist count for both
        // Same WebCraft name logged in again (second tab, or the old connection died without closing, e.g. a
        // laptop going to sleep): like Minecraft, the new login wins and the old one is closed.
        WcSession old = findSession(fullName);
        if (old != null) {
            old.kicked("Du hast dich woanders mit diesem Namen eingeloggt.");
            handleDisconnect(old);
        }
        if (sessions.size() >= maxPlayers) {
            fail(s, "WebCraft is full right now, try again later");
            return;
        }
        if (Bukkit.getPlayerExact(fullName) != null) {
            fail(s, "Name is already in use");
            return;
        }
        OfflinePlayer account = Bukkit.getOfflinePlayer(WcFakePlayer.uuidFor(accountName));
        if (account.isBanned()) {
            fail(s, "You are banned from this server");
            return;
        }
        if (Bukkit.hasWhitelist() && !account.isWhitelisted()) {
            fail(s, "Not on the whitelist. Ask an admin: /webcraft whitelist " + rawName);
            return;
        }
        boolean firstJoin = !Bukkit.getOfflinePlayer(WcFakePlayer.uuidFor(fullName)).hasPlayedBefore() && !ownWorld;
        if (!joining.add(fullName.toLowerCase())) {
            fail(s, "Name is already in use");
            return;
        }
        s.name = fullName;

        // Like a real login: plugins (permissions like LuckPerms, bans, maintenance ...) load their data in
        // AsyncPlayerPreLoginEvent, which must run off the main thread. Then the join goes on here.
        java.net.InetAddress ip = s.conn.getRemoteSocketAddress() == null ? java.net.InetAddress.getLoopbackAddress()
                : s.conn.getRemoteSocketAddress().getAddress();
        UUID uuid = WcFakePlayer.uuidFor(fullName);
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            // The skin of the Minecraft account the player picked (signed by Mojang, so everybody sees it)
            if (skinName != null && !skinName.isBlank()) s.skin = skins.lookup(skinName.trim());
            org.bukkit.event.player.AsyncPlayerPreLoginEvent pre = new org.bukkit.event.player.AsyncPlayerPreLoginEvent(fullName, ip, uuid);
            try {
                Bukkit.getPluginManager().callEvent(pre);
            } catch (Exception e) {
                getLogger().log(Level.WARNING, "AsyncPlayerPreLoginEvent failed for " + fullName, e);
            }
            Bukkit.getScheduler().runTask(this, () -> {
                joining.remove(fullName.toLowerCase());
                finishLogin(s, fullName, firstJoin, pre, single, creative);
            });
        });
    }

    private final Set<String> joining = new HashSet<>();

    /** A skin picture for the browser (downloaded once, then from plugins/WebCraft/skins/). */
    /** Names of blocks, items and mobs in the browser's language (loaded from Mojang once). */
    private void sendLang(WcSession s, String code) {
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            JsonObject m = lang.message(code);
            if (m != null) s.send(m);
        });
    }

    private void sendSkin(WcSession s, String hash) {
        if (hash == null || s.skinsAsked.size() > 200 || !s.skinsAsked.add(hash)) return;
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> s.send(skins.message(hash, skins.picture(hash))));
    }

    private void finishLogin(WcSession s, String fullName, boolean firstJoin, org.bukkit.event.player.AsyncPlayerPreLoginEvent pre,
                             boolean single, boolean creative) {
        if (s.closed) return;
        if (pre.getLoginResult() != org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.ALLOWED) {
            String msg = plain(pre.kickMessage());
            fail(s, msg == null || msg.isBlank() ? "Login refused by the server" : msg);
            return;
        }
        if (Bukkit.getPlayerExact(fullName) != null) {
            fail(s, "Name is already in use");
            return;
        }
        try {
            // Single player: the own world is loaded first, so a position saved there is found again
            World start = single && creative ? singlePlayer.world(fullName, World.Environment.NORMAL) : joinWorld();
            s.fake = WcFakePlayer.join(this, s, fullName, start, s.conn.getRemoteSocketAddress());
        } catch (WcFakePlayer.LoginDenied e) {
            fail(s, e.getMessage());
            return;
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "WebCraft: could not create player " + fullName, e);
            fail(s, "Server error while joining, see server log");
            return;
        }
        Player p = s.fake.bukkit();
        sessions.put(s.id, s);
        byPlayer.put(p.getUniqueId(), s);
        if (single && creative) singlePlayer.afterJoin(p);
        else if (single) singlePlayer.afterJoinSolo(p);
        boolean moved = firstJoin && migrateOldData(p);
        if (!moved && !validLocation(p.getLocation())) {
            // Broken saved position: back to the world spawn on solid ground
            World w = p.getWorld();
            Location spawn = w.getSpawnLocation();
            int y = w.getHighestBlockYAt(spawn.getBlockX(), spawn.getBlockZ()) + 1;
            p.teleport(new Location(w, spawn.getBlockX() + 0.5, y, spawn.getBlockZ() + 0.5, spawn.getYaw(), 0f));
        }

        freeFromBlocks(p);

        Location loc = p.getLocation();
        s.fake.location = loc;
        s.worldName = loc.getWorld().getName();
        JsonObject welcome = new JsonObject();
        welcome.addProperty("t", "welcome");
        welcome.addProperty("name", fullName);
        welcome.addProperty("entityId", p.getEntityId());
        skins.addTo(welcome, ((org.bukkit.craftbukkit.entity.CraftPlayer) p).getHandle().getGameProfile());   // own skin (F5, hand)
        welcome.addProperty("world", loc.getWorld().getName());
        welcome.addProperty("minY", loc.getWorld().getMinHeight());
        welcome.addProperty("maxY", loc.getWorld().getMaxHeight());
        welcome.addProperty("viewDistance", viewDistance);
        welcome.addProperty("env", loc.getWorld().getEnvironment().name());
        addBorder(welcome, loc.getWorld());
        addPos(welcome, loc);
        s.send(welcome);
        JsonObject pack = textures.message();
        if (pack != null) s.send(pack);
        sendItemList(s);
        s.invDirty = true;
        s.statsDirty = true;
        updateChunks(s, true);
        getLogger().info(fullName + " joined via WebCraft from " + s.conn.getRemoteSocketAddress());
    }

    private void fail(WcSession s, String message) {
        JsonObject err = new JsonObject();
        err.addProperty("t", "error");
        err.addProperty("msg", message);
        s.send(err);
        s.conn.close(1000, message);
    }

    /** Called when the browser connection is gone. */
    @Override
    public void handleDisconnect(WcSession s) {
        if (s.name == null || sessions.remove(s.id) == null) return;
        if (s.fake != null) {
            if (singlePlayer != null) singlePlayer.leftSolo(s.fake.bukkit());
            byPlayer.remove(s.fake.bukkit().getUniqueId());
            if (!s.fake.isRemoved()) s.fake.remove();
        }
        if (singlePlayer != null && singlePlayer.isSingle(s.name)) singlePlayer.afterQuit(s.name);
        getLogger().info(s.name + " left WebCraft");
    }

    @Override
    public void runSync(Runnable r) {
        if (!isEnabled()) return;
        try {
            Bukkit.getScheduler().runTask(this, r);
        } catch (IllegalStateException ignored) {
            // plugin is shutting down
        }
    }

    @Override
    public java.util.logging.Logger logger() {
        return getLogger();
    }

    WcSession sessionOf(Player p) {
        return byPlayer.get(p.getUniqueId());
    }

    /**
     * Before the rename the plugin was called "GgBridge". Its folder (config with the old "gg_" name prefix,
     * textures, block log) is copied once, so existing players keep their names and everything they own.
     */
    private void takeOverOldFolder() {
        File old = new File(getDataFolder().getParentFile(), "GgBridge");
        if (!old.isDirectory() || getDataFolder().exists()) return;
        try (var files = java.nio.file.Files.walk(old.toPath())) {
            for (java.nio.file.Path from : (Iterable<java.nio.file.Path>) files::iterator) {
                java.nio.file.Path to = getDataFolder().toPath().resolve(old.toPath().relativize(from).toString());
                if (java.nio.file.Files.isDirectory(from)) java.nio.file.Files.createDirectories(to);
                else java.nio.file.Files.copy(from, to);
            }
            getLogger().info("Took over the settings of the old GgBridge plugin (plugins/GgBridge can be deleted)");
        } catch (IOException e) {
            getLogger().log(Level.WARNING, "Could not copy plugins/GgBridge", e);
        }
    }

    /** Position and inventory from gg 0.2 (the old name; before its players were real players). */
    private boolean migrateOldData(Player p) {
        boolean moved = false;
        String key = p.getName().toLowerCase();
        File posFile = new File(getDataFolder(), "positions.yml");
        if (posFile.exists()) {
            YamlConfiguration pos = YamlConfiguration.loadConfiguration(posFile);
            if (pos.contains(key)) {
                World w = Bukkit.getWorld(pos.getString(key + ".world", ""));
                Location old = w == null ? null : new Location(w, pos.getDouble(key + ".x"), pos.getDouble(key + ".y"),
                        pos.getDouble(key + ".z"), (float) pos.getDouble(key + ".yaw"), (float) pos.getDouble(key + ".pitch"));
                if (old != null && validLocation(old)) {
                    p.teleport(new Location(w, pos.getDouble(key + ".x"), pos.getDouble(key + ".y"), pos.getDouble(key + ".z"),
                            (float) pos.getDouble(key + ".yaw"), (float) pos.getDouble(key + ".pitch")));
                    moved = true;
                }
                pos.set(key, null);
                saveQuietly(pos, posFile);
            }
        }
        File invFile = new File(getDataFolder(), "inventories.yml");
        if (invFile.exists()) {
            YamlConfiguration inv = YamlConfiguration.loadConfiguration(invFile);
            ConfigurationSection sec = inv.getConfigurationSection(key);
            if (sec != null) {
                for (String slot : sec.getKeys(false)) {
                    if (slot.equals("sel")) continue;
                    try {
                        ItemStack item = ItemStack.deserializeBytes(Base64.getDecoder().decode(sec.getString(slot)));
                        p.getInventory().addItem(item).values().forEach(rest -> p.getWorld().dropItem(p.getLocation(), rest));
                    } catch (Exception ignored) {
                        // item from an incompatible version, skip it
                    }
                }
                inv.set(key, null);
                saveQuietly(inv, invFile);
            }
        }
        return moved;
    }

    /** Saved position inside blocks (e.g. after a lag correction): move up to the next free space. */
    private static void freeFromBlocks(Player p) {
        net.minecraft.server.level.ServerPlayer sp = ((org.bukkit.craftbukkit.entity.CraftPlayer) p).getHandle();
        if (sp.level().noCollision(sp, sp.getBoundingBox().deflate(1.0E-3))) return;
        Location l = p.getLocation();
        for (int dy = 1; dy <= 64; dy++) {
            double y = Math.floor(l.getY()) + dy;
            if (y + 2 > l.getWorld().getMaxHeight()) break;
            var box = sp.getBoundingBox().move(0, y - sp.getY(), 0).deflate(1.0E-3);
            if (sp.level().noCollision(sp, box)) {
                Location up = l.clone();
                up.setY(y);
                p.teleport(up);
                return;
            }
        }
    }

    private static boolean validLocation(Location l) {
        return Double.isFinite(l.getX()) && Double.isFinite(l.getY()) && Double.isFinite(l.getZ())
                && Float.isFinite(l.getYaw()) && Float.isFinite(l.getPitch()) && Math.abs(l.getX()) < 3e7 && Math.abs(l.getZ()) < 3e7;
    }

    private void saveQuietly(YamlConfiguration yml, File file) {
        try {
            yml.save(file);
        } catch (IOException e) {
            getLogger().log(Level.WARNING, "Could not save " + file.getName(), e);
        }
    }

    private int digTicks(Player p, int x, int y, int z) {
        Block b = p.getWorld().getBlockAt(x, y, z);
        int ticks;
        float hardness = b.getType().getHardness();
        if (b.getType().isAir() || b.isLiquid()) ticks = -1;
        else if (p.getGameMode() == GameMode.CREATIVE) ticks = 0;
        else if (hardness < 0 || p.getGameMode() == GameMode.ADVENTURE || p.getGameMode() == GameMode.SPECTATOR) ticks = -1;
        else {
            float perTick = b.getBreakSpeed(p);
            ticks = perTick >= 1f ? 0 : perTick <= 0f ? -1 : (int) Math.ceil(1f / perTick);
        }
        return ticks;
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
        tickCounter++;
        if (sessions.isEmpty()) {
            pendingBlocks.clear();
            return;
        }
        for (WcSession s : sessions.values()) {
            if (s.closed || s.fake == null || s.fake.isRemoved()) continue;
            s.fake.tick();
            if (s.fake.isRemoved()) continue;
            Player p = s.fake.bukkit();
            Location loc = p.getLocation();
            boolean worldChanged = !loc.getWorld().getName().equals(s.worldName);
            s.fake.location = loc;
            if (worldChanged) changeWorld(s, loc);
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
                    net.minecraft.core.BlockPos pos = (net.minecraft.core.BlockPos) c[0];
                    JsonArray entry = new JsonArray();
                    entry.add(pos.getX());
                    entry.add(pos.getY());
                    entry.add(pos.getZ());
                    entry.add(palette.idOf((net.minecraft.world.level.block.state.BlockState) c[1]));
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
            JsonObject snd = WcSounds.take(s.sounds);
            if (snd != null) s.send(snd);
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
                m.addProperty("v", p.getWorld().getFullTime());
                WcWeather.addTo(m, ((org.bukkit.craftbukkit.entity.CraftPlayer) p).getHandle());
                s.send(m);
            }
        }
        if (!pendingBlocks.isEmpty()) flushBlockChanges();
        if (tickCounter % 2 == 0) sendEntities();
        if (tickCounter % 20 == 0) sendTabLists();
    }

    private void changeWorld(WcSession s, Location loc) {
        s.worldName = loc.getWorld().getName();
        s.sentChunks.clear();
        s.loading.clear();
        s.chunkQueue.clear();
        JsonObject m = new JsonObject();
        m.addProperty("t", "world");
        m.addProperty("world", s.worldName);
        m.addProperty("minY", loc.getWorld().getMinHeight());
        m.addProperty("maxY", loc.getWorld().getMaxHeight());
        m.addProperty("env", loc.getWorld().getEnvironment().name());
        addBorder(m, loc.getWorld());
        addPos(m, loc);
        s.send(m);
        updateChunks(s, true);
    }

    private void sendStats(WcSession s, Player p) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "stats");
        m.addProperty("hp", round(p.getHealth()));
        m.addProperty("max", round(attr(p, Attribute.MAX_HEALTH, 20)));
        m.addProperty("food", p.getFoodLevel());
        m.addProperty("armor", (int) Math.round(attr(p, Attribute.ARMOR, 0)));
        m.addProperty("lvl", p.getLevel());
        m.addProperty("xp", round(p.getExp()));
        m.addProperty("air", p.getRemainingAir());
        m.addProperty("maxAir", p.getMaximumAir());
        m.addProperty("fly", p.getAllowFlight());
        m.addProperty("gm", p.getGameMode().name());
        m.addProperty("as", round(attr(p, Attribute.ATTACK_SPEED, 4)));
        addBorder(m, p.getWorld());   // the border can move (shrinking border plugins)
        m.addProperty("dead", p.isDead());
        // Potion effects: [key, level (0 = I), seconds left] for the effects display
        JsonArray eff = new JsonArray();
        for (org.bukkit.potion.PotionEffect e : p.getActivePotionEffects()) {
            JsonArray a = new JsonArray();
            a.add(e.getType().getKey().getKey());
            a.add(e.getAmplifier());
            a.add(e.isInfinite() ? -1 : e.getDuration() / 20);
            eff.add(a);
        }
        if (!eff.isEmpty()) m.add("eff", eff);
        String key = m.toString();
        if (key.equals(s.lastStats)) return;
        s.lastStats = key;
        s.send(m);
    }

    private static double attr(Player p, Attribute a, double fallback) {
        AttributeInstance inst = p.getAttribute(a);
        return inst == null ? fallback : inst.getValue();
    }

    private void sendInventory(WcSession s, Player p) {
        // Hotbar for the HUD
        PlayerInventory inv = p.getInventory();
        JsonObject hud = new JsonObject();
        hud.addProperty("t", "inv");
        JsonArray hot = new JsonArray();
        for (int i = 0; i < 9; i++) hot.add(WcItems.json(inv.getItem(i)));
        hud.add("hot", hot);
        hud.add("off", WcItems.json(inv.getItemInOffHand()));
        hud.addProperty("sel", inv.getHeldItemSlot());
        // Armor (helmet, chest, legs, boots) for the armor display mod
        JsonArray arm = new JsonArray();
        for (ItemStack a : new ItemStack[] {inv.getHelmet(), inv.getChestplate(), inv.getLeggings(), inv.getBoots()}) arm.add(WcItems.json(a));
        hud.add("arm", arm);
        s.send(hud);

        // The open screen (own inventory, chest, workbench, plugin GUI ...)
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
            // The server closed the container (e.g. a plugin GUI)
            JsonObject menu = new JsonObject();
            menu.addProperty("t", "menu");
            menu.addProperty("open", false);
            s.send(menu);
            s.sentContainer = false;
        }
    }

    // ------------------------------------------------------------------ chunk streaming

    private void updateChunks(WcSession s, boolean force) {
        int cx = s.fake.location.getBlockX() >> 4;
        int cz = s.fake.location.getBlockZ() >> 4;
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
        World world = s.fake.location.getWorld();
        String worldAtStart = world.getName();
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
            if (outsideBorder(world, cx, cz)) {
                sendEmptyChunk(s, cx, cz);
                continue;
            }
            s.loading.put(key, now);
            fresh++;
            // The chunks right around the player first and fast
            int pdx = cx - (s.fake.location.getBlockX() >> 4), pdz = cz - (s.fake.location.getBlockZ() >> 4);
            boolean urgent = pdx * pdx + pdz * pdz <= 2;
            var future = urgent ? world.getChunkAtAsyncUrgently(cx, cz) : world.getChunkAtAsync(cx, cz, true);
            future.whenComplete((chunk, err) -> {
                Runnable snap = () -> {
                    s.loading.remove(key);
                    if (s.closed) return;
                    if (err != null || chunk == null) {
                        // Could not be loaded (e.g. generation blocked): show it as empty
                        sendEmptyChunk(s, cx, cz);
                        return;
                    }
                    if (!worldAtStart.equals(s.worldName)) return;
                    if (!s.sentChunks.contains(key)) return;       // not wanted any more (walked away)
                    List<ChunkEncoder.Section> sections;
                    try {
                        sections = ChunkEncoder.copy(
                                ((org.bukkit.craftbukkit.CraftChunk) chunk).getHandle(net.minecraft.world.level.chunk.status.ChunkStatus.FULL));
                    } catch (RuntimeException ex) {
                        getLogger().log(Level.WARNING, "Could not read chunk " + cx + "," + cz, ex);
                        s.sentChunks.remove(key);
                        return;
                    }
                    s.inFlight.incrementAndGet();
                    Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                        try {
                            if (!s.closed) s.sendWithPalette(palette, ChunkEncoder.encode(cx, cz, sections, palette));
                        } catch (Exception e) {
                            getLogger().log(Level.WARNING, "Could not encode chunk " + cx + "," + cz, e);
                        } finally {
                            s.inFlight.decrementAndGet();
                        }
                    });
                };
                if (Bukkit.isPrimaryThread()) snap.run();
                else Bukkit.getScheduler().runTask(this, snap);
            });
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
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                if (!s.closed) s.sendWithPalette(palette, ChunkEncoder.encode(cx, cz, List.of(), palette));
            } catch (Exception e) {
                getLogger().log(Level.WARNING, "Could not encode empty chunk " + cx + "," + cz, e);
            } finally {
                s.inFlight.decrementAndGet();
            }
        });
    }

    /** True if the whole chunk lies outside the world border. */
    private static boolean outsideBorder(World world, int cx, int cz) {
        org.bukkit.WorldBorder border = world.getWorldBorder();
        double half = border.getSize() / 2;
        Location c = border.getCenter();
        double x0 = cx * 16, z0 = cz * 16;
        return x0 + 16 <= c.getX() - half || x0 >= c.getX() + half || z0 + 16 <= c.getZ() - half || z0 >= c.getZ() + half;
    }

    /** World border for the browser (shown as a wall, you can't walk through it). */
    static void addBorder(JsonObject o, World world) {
        org.bukkit.WorldBorder border = world.getWorldBorder();
        JsonObject b = new JsonObject();
        b.addProperty("x", border.getCenter().getX());
        b.addProperty("z", border.getCenter().getZ());
        b.addProperty("size", Math.min(border.getSize(), 6.0e7));
        o.add("border", b);
    }

    // ------------------------------------------------------------------ block updates

    /** Called by the listener whenever a block may have changed. */
    void queueBlockCheck(World world, int x, int y, int z) {
        if (sessions.isEmpty() || pendingBlocks.size() >= MAX_PENDING_BLOCKS) return;
        pendingBlocks.add(new BlockPos(world.getName(), x, y, z));
    }

    /**
     * The browser shows placing and breaking right away. Send the real blocks around the spot a little
     * later, so a refused action (protection plugin, not done yet ...) is corrected on the screen.
     */
    private void confirmBlocks(World world, int x, int y, int z) {
        for (long delay : new long[] {3L, 20L, 70L}) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                queueBlockCheck(world, x, y, z);
                queueBlockCheck(world, x + 1, y, z);
                queueBlockCheck(world, x - 1, y, z);
                queueBlockCheck(world, x, y + 1, z);
                queueBlockCheck(world, x, y - 1, z);
                queueBlockCheck(world, x, y, z + 1);
                queueBlockCheck(world, x, y, z - 1);
            }, delay);
        }
    }

    void logBlock(Player p, String action, Block b) {
        if (logBlocks && sessionOf(p) != null) blockLog.log(p.getName(), action, b);
    }

    private void flushBlockChanges() {
        Map<WcSession, JsonArray> perSession = new HashMap<>();
        for (BlockPos pos : pendingBlocks) {
            World world = Bukkit.getWorld(pos.world());
            if (world == null) continue;
            int cx = pos.x() >> 4, cz = pos.z() >> 4;
            if (!world.isChunkLoaded(cx, cz)) continue;
            int id = palette.idOf(((org.bukkit.craftbukkit.CraftWorld) world).getHandle().getBlockState(
                    new net.minecraft.core.BlockPos(pos.x(), pos.y(), pos.z())));
            long key = WcSession.key(cx, cz);
            for (WcSession s : sessions.values()) {
                if (!pos.world().equals(s.worldName) || !s.sentChunks.contains(key)) continue;
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
            Player self = s.fake.bukkit();
            Location center = s.fake.location;
            List<Entity> near = new ArrayList<>(center.getWorld().getNearbyEntities(center, entityRange, entityRange, entityRange,
                    e -> e != self && shown(e)));
            // Players, holograms and falling blocks first, then everything else by distance
            near.sort(Comparator.comparingInt((Entity e) -> priority(e))
                    .thenComparingDouble(e -> e.getLocation().distanceSquared(center)));
            JsonArray list = new JsonArray();
            int n = 0;
            for (Entity e : near) {
                if (n >= MAX_ENTITIES) break;
                if (e instanceof Player other && (!self.canSee(other) || other.getGameMode() == GameMode.SPECTATOR)) continue;
                JsonObject json = entityJson(e);
                if (json == null) continue;
                list.add(json);
                n++;
            }
            // Holograms that only exist as packets (DecentHolograms & co.)
            double r2 = entityRange * entityRange;
            for (WcSession.Virtual v : s.virtualEntities.values()) {
                if (v.text == null || v.text.isBlank()) continue;
                double dx = v.x - center.getX(), dy = v.y - center.getY(), dz = v.z - center.getZ();
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

    /** The look of a mob type that has several (pink sheep are done with "col"). */
    private static String variantOf(Entity e) {
        try {
            if (e instanceof org.bukkit.entity.MushroomCow m) return m.getVariant().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Fox f) return f.getFoxType().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Axolotl a) return a.getVariant().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Parrot p) return p.getVariant().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Horse h) return h.getColor().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Llama l) return l.getColor().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Rabbit r) return r.getRabbitType().name().toLowerCase();
            if (e instanceof org.bukkit.entity.Cat c) return c.getCatType().getKey().getKey();
            if (e instanceof org.bukkit.entity.Frog f) return f.getVariant().getKey().getKey();
            if (e instanceof org.bukkit.entity.Wolf w) return w.getVariant().getKey().getKey();
            if (e instanceof org.bukkit.entity.Villager v) return v.getProfession().getKey().getKey();
            if (e instanceof org.bukkit.entity.ZombieVillager v) return v.getVillagerProfession().getKey().getKey();
            if (e instanceof org.bukkit.entity.Cow c) return c.getVariant().getKey().getKey();
            if (e instanceof org.bukkit.entity.Pig p) return p.getVariant().getKey().getKey();
            if (e instanceof org.bukkit.entity.Chicken c) return c.getVariant().getKey().getKey();
            if (e instanceof org.bukkit.entity.TropicalFish t) return t.getPattern().name().toLowerCase();
        } catch (Throwable ignored) {
            // API differs on this server version: just the default look
        }
        return null;
    }

    private static int priority(Entity e) {
        if (e instanceof Player || e instanceof org.bukkit.entity.Display || e instanceof org.bukkit.entity.FallingBlock
                || e instanceof org.bukkit.entity.Projectile) return 0;
        if (e.customName() != null && e.isCustomNameVisible()) return 0;
        if (e instanceof Item) return 2;
        return 1;
    }

    private static boolean shown(Entity e) {
        return e instanceof LivingEntity || e instanceof Item || e instanceof org.bukkit.entity.FallingBlock
                || e instanceof org.bukkit.entity.Display || e instanceof org.bukkit.entity.Vehicle
                || e instanceof org.bukkit.entity.Projectile || e instanceof org.bukkit.entity.LightningStrike;
    }

    private static String plain(net.kyori.adventure.text.Component c) {
        return c == null ? null : PlainTextComponentSerializer.plainText().serialize(c);
    }

    private JsonObject entityJson(Entity e) {
        JsonObject o = new JsonObject();
        o.addProperty("i", e.getEntityId());
        o.addProperty("type", e.getType().getKey().getKey());
        String name = e.customName() != null && e.isCustomNameVisible() ? plain(e.customName()) : null;
        // Invisible entities only show up as their name tag (classic armor-stand holograms)
        if (e instanceof LivingEntity le && le.isInvisible() && !(e instanceof Player)) {
            if (name == null || name.isBlank()) return null;
            o.addProperty("type", "label");
            o.addProperty("txt", name);
            Location l = e.getLocation();
            o.addProperty("x", round(l.getX()));
            o.addProperty("y", round(l.getY() + e.getHeight()));
            o.addProperty("z", round(l.getZ()));
            return o;
        }
        Location l = e.getLocation();
        o.addProperty("x", round(l.getX()));
        o.addProperty("y", round(l.getY()));
        o.addProperty("z", round(l.getZ()));
        BoundingBox bb = e.getBoundingBox();
        o.addProperty("w", round(bb.getWidthX()));
        o.addProperty("h", round(bb.getHeight()));
        if (e instanceof Item item) {
            o.addProperty("k", item.getItemStack().getType().getKey().getKey());
            return o;
        }
        if (e instanceof org.bukkit.entity.Projectile) {
            // Thrown things (wind charge, snowball, pearl, potion ...) look like their item; arrows have a direction
            ItemStack it = null;
            if (e instanceof org.bukkit.entity.ThrowableProjectile tp) it = tp.getItem();
            else if (e instanceof org.bukkit.entity.Firework fw) it = new ItemStack(org.bukkit.Material.FIREWORK_ROCKET);
            else if (e instanceof org.bukkit.entity.Trident) it = new ItemStack(org.bukkit.Material.TRIDENT);
            else if (e instanceof org.bukkit.entity.WindCharge) it = new ItemStack(org.bukkit.Material.WIND_CHARGE);
            else if (e instanceof org.bukkit.entity.Fireball) it = new ItemStack(org.bukkit.Material.FIRE_CHARGE);
            if (it != null && !it.getType().isAir()) o.addProperty("k", it.getType().getKey().getKey());
            org.bukkit.util.Vector v = e.getVelocity();
            o.addProperty("vx", round(v.getX()));
            o.addProperty("vy", round(v.getY()));
            o.addProperty("vz", round(v.getZ()));
            o.addProperty("proj", true);
            return o;
        }
        if (e instanceof org.bukkit.entity.FallingBlock fb) {
            o.addProperty("b", palette.idOf(((org.bukkit.craftbukkit.block.data.CraftBlockData) fb.getBlockData()).getState()));
            return o;
        }
        if (e instanceof org.bukkit.entity.Display d) {
            org.bukkit.util.Transformation tr = d.getTransformation();
            o.addProperty("sx", round(tr.getScale().x()));
            o.addProperty("sy", round(tr.getScale().y()));
            o.addProperty("sz", round(tr.getScale().z()));
            o.addProperty("tx", round(tr.getTranslation().x()));
            o.addProperty("ty", round(tr.getTranslation().y()));
            o.addProperty("tz", round(tr.getTranslation().z()));
            if (d instanceof org.bukkit.entity.TextDisplay td) {
                String text = plain(td.text());
                if (text == null || text.isBlank()) return null;
                o.addProperty("txt", text);
            } else if (d instanceof org.bukkit.entity.BlockDisplay bd) {
                o.addProperty("b", palette.idOf(((org.bukkit.craftbukkit.block.data.CraftBlockData) bd.getBlock()).getState()));
            } else if (d instanceof org.bukkit.entity.ItemDisplay id) {
                ItemStack it = id.getItemStack();
                if (it == null || it.getType().isAir()) return null;
                o.addProperty("k", it.getType().getKey().getKey());
            } else {
                return null;
            }
            o.addProperty("yaw", round(l.getYaw()));
            return o;
        }
        o.addProperty("yaw", round(l.getYaw()));
        o.addProperty("pitch", round(l.getPitch()));
        if (e instanceof LivingEntity le) {
            o.addProperty("body", round(le.getBodyYaw()));
            if (le.getNoDamageTicks() > le.getMaximumNoDamageTicks() / 2) o.addProperty("hurt", true);
            if (le.isDead() || le.getHealth() <= 0) o.addProperty("dead", true);
            if (le.isHandRaised()) o.addProperty("use", true);   // eating, drinking, drawing a bow ...
            String variant = variantOf(e);
            if (variant != null) o.addProperty("var", variant);
            if (e instanceof org.bukkit.entity.Sheep sheep) {
                if (sheep.getColor() != null) o.addProperty("col", sheep.getColor().getColor().asRGB());
                if (sheep.isSheared()) o.addProperty("sheared", true);
            }
            if (e instanceof org.bukkit.entity.TropicalFish fish) {
                o.addProperty("col", fish.getBodyColor().getColor().asRGB());
                o.addProperty("col2", fish.getPatternColor().getColor().asRGB());
            }
            if (le instanceof org.bukkit.entity.Ageable ag && !ag.isAdult()) o.addProperty("baby", true);
            if (le.getEquipment() != null) {
                org.bukkit.inventory.EntityEquipment eq = le.getEquipment();
                ItemStack hand = eq.getItemInMainHand();
                if (!hand.getType().isAir()) o.addProperty("hand", hand.getType().getKey().getKey());
                // Armor, so you can see who is wearing what
                ItemStack[] armor = {eq.getHelmet(), eq.getChestplate(), eq.getLeggings(), eq.getBoots()};
                JsonArray arm = new JsonArray();
                boolean any = false;
                for (ItemStack a : armor) {
                    if (a == null || a.getType().isAir()) arm.add(com.google.gson.JsonNull.INSTANCE);
                    else {
                        arm.add(a.getType().getKey().getKey());
                        any = true;
                    }
                }
                if (any) o.add("arm", arm);
            }
        }
        if (e instanceof Player p) {
            o.addProperty("n", p.getName());
            skins.addTo(o, ((org.bukkit.craftbukkit.entity.CraftPlayer) p).getHandle().getGameProfile());
            if (byPlayer.containsKey(p.getUniqueId())) o.addProperty("wc", true);
            if (p.isSneaking()) o.addProperty("sn", true);
            if (p.isSwimming()) o.addProperty("sw", true);
        } else if (name != null) {
            o.addProperty("n", name);
        }
        return o;
    }

    // ------------------------------------------------------------------ texture pack

    private WcTextures textures;

    /** An admin uploads a pack from the texture studio: save it and give it to every WebCraft player. */
    private void uploadPack(WcSession s, WcFakePlayer f, String base64) {
        if (!f.bukkit().hasPermission("webcraft.textures")) {
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
            getLogger().info(s.name + " uploaded a texture pack with " + count + " textures");
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
            for (org.bukkit.Material m : org.bukkit.Material.values()) {
                try {
                    if (m.isLegacy() || m.isAir()) continue;
                    if (m.isItem()) keys.add(m.getKey().getKey());
                    if (m.isBlock()) {
                        blocks.add(m.getKey().getKey());
                        // Make sure the browser knows how the block looks (for item icons)
                        palette.idOf(org.bukkit.craftbukkit.util.CraftMagicNumbers.getBlock(m).defaultBlockState());
                    }
                } catch (Throwable ignored) {
                    // some materials have no item or block form
                }
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
        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        online.sort(Comparator.comparing(p -> p.getName().toLowerCase()));
        for (WcSession s : sessions.values()) {
            if (s.closed || s.fake == null || s.fake.isRemoved()) continue;
            Player self = s.fake.bukkit();
            JsonArray list = new JsonArray();
            for (Player p : online) {
                if (p != self && !self.canSee(p)) continue;
                JsonObject o = new JsonObject();
                o.addProperty("n", p.getName());
                String shown = plain(p.playerListName());
                if (shown != null && !shown.equals(p.getName())) o.addProperty("d", shown);
                if (byPlayer.containsKey(p.getUniqueId())) o.addProperty("wc", true);
                else o.addProperty("ping", p.getPing());
                if (p.getGameMode() == GameMode.SPECTATOR) o.addProperty("spec", true);
                list.add(o);
            }
            JsonObject msg = new JsonObject();
            msg.addProperty("t", "tab");
            msg.add("players", list);
            msg.addProperty("header", s.tabHeader);
            msg.addProperty("footer", s.tabFooter);
            msg.addProperty("max", Bukkit.getMaxPlayers());
            String key = msg.toString();
            if (key.equals(s.lastTab)) continue;
            s.lastTab = key;
            s.send(msg);
        }
    }

    // ------------------------------------------------------------------ /webcraft command

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase() : "status";
        switch (sub) {
            case "status" -> {
                sender.sendMessage(Component.text("WebCraft bridge on port " + port + ", "
                        + sessions.size() + "/" + maxPlayers + " WebCraft players", NamedTextColor.GOLD));
                for (WcSession s : sessions.values()) {
                    Location l = s.fake.location;
                    String dist = "";
                    if (s.fake != null && !s.fake.isRemoved()) {
                        Player p = s.fake.bukkit();
                        dist = (p.isDead() ? " (dead)" : "") + " (WebCraft chunks " + s.sentChunks.size() + ", loading " + s.loading.size()
                                + ", queue " + s.chunkQueue.size() + "; " + s.fake.chunkLoaderInfo() + ", " + s.fake.trackingInfo() + ")";
                    }
                    sender.sendMessage(Component.text(" - " + s.name + " at "
                            + l.getBlockX() + " " + l.getBlockY() + " " + l.getBlockZ() + dist, NamedTextColor.GRAY));
                }
            }
            case "kick" -> {
                if (args.length < 2) {
                    sender.sendMessage(Component.text("Usage: /webcraft kick <name>", NamedTextColor.RED));
                    return true;
                }
                WcSession s = findSession(args[1]);
                if (s == null) s = findSession(namePrefix + args[1]);
                if (s == null) {
                    sender.sendMessage(Component.text("No WebCraft player with that name", NamedTextColor.RED));
                } else {
                    s.fake.bukkit().kick(Component.text("Kicked by an admin"));
                    sender.sendMessage(Component.text("Kicked " + s.name, NamedTextColor.GREEN));
                }
            }
            case "reload" -> {
                for (WcSession s : new ArrayList<>(sessions.values())) fail(s, "WebCraft is restarting");
                stopServer();
                loadSettings();
                textures.load();
                startServer();
                sender.sendMessage(Component.text("WebCraft bridge reloaded (port " + port + ")", NamedTextColor.GREEN));
            }
            default -> sender.sendMessage(Component.text("Usage: /webcraft [status|kick <name>|reload]", NamedTextColor.RED));
        }
        return true;
    }

    // ------------------------------------------------------------------ small helpers

    private WcSession findSession(String name) {
        for (WcSession s : sessions.values()) if (s.name != null && s.name.equalsIgnoreCase(name)) return s;
        return null;
    }

    private static void addPos(JsonObject o, Location l) {
        o.addProperty("x", round(l.getX()));
        o.addProperty("y", round(l.getY()));
        o.addProperty("z", round(l.getZ()));
        o.addProperty("yaw", round(l.getYaw()));
        o.addProperty("pitch", round(l.getPitch()));
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
