package de.p300.webcraft;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

import java.util.Locale;

/**
 * Single player: a WebCraft player gets an own world (with own nether and end) on the server that nobody else can
 * enter. It is a separate player (name prefix "sp_" by default, so inventory, ender chest and xp are its own),
 * hidden from everybody else, without join/quit/death/advancement messages for the others, and chat stays private.
 * Worlds are folders "wcsp_<name>", "_nether", "_the_end" in the server folder, loaded on login, unloaded on leave.
 */
final class WcSingle implements Listener {

    private final WcPlugin plugin;
    final String prefix;

    WcSingle(WcPlugin plugin, String prefix) {
        this.plugin = plugin;
        this.prefix = prefix;
    }

    boolean isSingle(String name) {
        return name != null && name.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT));
    }

    boolean isSingle(Player p) {
        return isSingle(p.getName()) && plugin.sessionOf(p) != null;
    }

    private static String base(String playerName) {
        return "wcsp_" + playerName.toLowerCase(Locale.ROOT);
    }

    private static boolean owns(String playerName, World w) {
        String b = base(playerName);
        String n = w.getName();
        return n.equals(b) || n.equals(b + "_nether") || n.equals(b + "_the_end");
    }

    /** The player's world of that kind, loaded or created (main thread; a new world takes a few seconds). */
    World world(String playerName, World.Environment env) {
        String name = base(playerName) + switch (env) {
            case NETHER -> "_nether";
            case THE_END -> "_the_end";
            default -> "";
        };
        World w = Bukkit.getWorld(name);
        if (w != null) return w;
        plugin.getLogger().info("WebCraft: loading single player world " + name);
        return new WorldCreator(name).environment(env).keepSpawnLoaded(net.kyori.adventure.util.TriState.FALSE).createWorld();
    }

    /** After the join: into the own world (first time, or after it was somewhere else), game mode, hidden. */
    void afterJoin(Player p, boolean creative) {
        if (!owns(p.getName(), p.getWorld())) p.teleport(safeSpawn(world(p.getName(), World.Environment.NORMAL)));
        p.setGameMode(creative ? GameMode.CREATIVE : GameMode.SURVIVAL);
        for (Player o : Bukkit.getOnlinePlayers()) {
            if (o == p) continue;
            o.hidePlayer(plugin, p);
            p.hidePlayer(plugin, o);
        }
    }

    /** Unloads the player's worlds (saved) when nobody is in them any more. */
    void afterQuit(String playerName) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            for (String suffix : new String[] {"", "_nether", "_the_end"}) {
                World w = Bukkit.getWorld(base(playerName) + suffix);
                if (w != null && w.getPlayers().isEmpty()) Bukkit.unloadWorld(w, true);
            }
        }, 40L);
    }

    private static Location safeSpawn(World w) {
        Location s = w.getSpawnLocation();
        int y = w.getHighestBlockYAt(s.getBlockX(), s.getBlockZ()) + 1;
        return new Location(w, s.getBlockX() + 0.5, y, s.getBlockZ() + 0.5);
    }

    // ------------------------------------------------------------------ keep it private

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        if (isSingle(p.getName())) {
            e.joinMessage(null);
            return;
        }
        // Somebody else came online: single players stay invisible for them (and the other way round)
        for (Player o : Bukkit.getOnlinePlayers()) {
            if (o != p && isSingle(o)) {
                p.hidePlayer(plugin, o);
                o.hidePlayer(plugin, p);
            }
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onQuit(PlayerQuitEvent e) {
        if (isSingle(e.getPlayer().getName())) e.quitMessage(null);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onDeath(PlayerDeathEvent e) {
        if (isSingle(e.getEntity().getName())) e.deathMessage(null);   // the own death screen still has it
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAdvancement(PlayerAdvancementDoneEvent e) {
        if (isSingle(e.getPlayer().getName())) e.message(null);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onChat(io.papermc.paper.event.player.AsyncChatEvent e) {
        Player p = e.getPlayer();
        if (isSingle(p.getName())) {
            // Talking to yourself (and the console)
            e.viewers().removeIf(v -> v instanceof Player o && o != p);
        } else {
            e.viewers().removeIf(v -> v instanceof Player o && isSingle(o.getName()));
        }
    }

    /** Dying without a bed: back to the own world, not to the server's spawn. */
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onRespawn(PlayerRespawnEvent e) {
        Player p = e.getPlayer();
        if (isSingle(p.getName()) && !owns(p.getName(), e.getRespawnLocation().getWorld())) {
            e.setRespawnLocation(safeSpawn(world(p.getName(), World.Environment.NORMAL)));
        }
    }

    /** Nether and end portals lead into the own nether / end. */
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPortal(PlayerPortalEvent e) {
        Player p = e.getPlayer();
        if (!isSingle(p.getName())) return;
        Location from = e.getFrom();
        World.Environment here = from.getWorld().getEnvironment();
        if (e.getCause() == PlayerTeleportEvent.TeleportCause.NETHER_PORTAL) {
            if (here == World.Environment.NORMAL) {
                World nether = world(p.getName(), World.Environment.NETHER);
                e.setTo(new Location(nether, from.getX() / 8, Math.min(from.getY(), 120), from.getZ() / 8, from.getYaw(), from.getPitch()));
            } else if (here == World.Environment.NETHER) {
                World over = world(p.getName(), World.Environment.NORMAL);
                e.setTo(new Location(over, from.getX() * 8, from.getY(), from.getZ() * 8, from.getYaw(), from.getPitch()));
            }
        } else if (e.getCause() == PlayerTeleportEvent.TeleportCause.END_PORTAL) {
            if (here == World.Environment.THE_END) {
                // Back home: the bed if it is in the own world, else the world spawn
                Location bed = p.getRespawnLocation();
                e.setTo(bed != null && owns(p.getName(), bed.getWorld()) ? bed : safeSpawn(world(p.getName(), World.Environment.NORMAL)));
            } else {
                World end = world(p.getName(), World.Environment.THE_END);
                endPlatform(end);
                e.setTo(new Location(end, 100.5, 49, 0.5, 90f, 0f));
            }
        }
    }

    /** The obsidian platform Minecraft puts at (100, 48, 0) in the end, with air above it. */
    private static void endPlatform(World end) {
        for (int x = 98; x <= 102; x++) {
            for (int z = -2; z <= 2; z++) {
                end.getBlockAt(x, 48, z).setType(Material.OBSIDIAN, false);
                for (int y = 49; y <= 51; y++) end.getBlockAt(x, y, z).setType(Material.AIR, false);
            }
        }
    }
}
