package de.p300.webcraft;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Own worlds ("servers") on this server: /welt erstellen, /welt <name>, /welt verlassen ...
 *
 * Creating needs webcraft.server.create, entering someone else's world webcraft.server.join. Only OPs have
 * them by default; others get them with a permission plugin like LuckPerms.
 * The worlds are normal Bukkit worlds "welt_<name>", remembered in plugins/WebCraft/worlds.yml.
 */
final class WcWorlds implements TabExecutor {

    static final String PERM_CREATE = "webcraft.server.create";
    static final String PERM_JOIN = "webcraft.server.join";
    static final String PERM_ADMIN = "webcraft.server.admin";
    private static final String PREFIX = "welt_";
    private static final Pattern NAME = Pattern.compile("^[a-z0-9_]{3,16}$");

    private final WcPlugin plugin;
    private final File file;
    private final Map<String, Entry> worlds = new HashMap<>();
    /** Where a player was before entering a world, for /welt verlassen. */
    private final Map<UUID, Location> back = new HashMap<>();
    /** Names a player asked to delete, waiting for "bestätigen". */
    private final Map<UUID, String> pendingDelete = new HashMap<>();
    private int maxPerPlayer = 1;

    record Entry(String name, UUID owner, String ownerName, String type, long created) {}

    WcWorlds(WcPlugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "worlds.yml");
    }

    /** Reads worlds.yml and loads every world (at server start, before players join). */
    void load(int maxPerPlayer) {
        this.maxPerPlayer = maxPerPlayer;
        worlds.clear();
        if (!file.exists()) return;
        YamlConfiguration yml = YamlConfiguration.loadConfiguration(file);
        ConfigurationSection sec = yml.getConfigurationSection("worlds");
        if (sec == null) return;
        for (String name : sec.getKeys(false)) {
            ConfigurationSection w = sec.getConfigurationSection(name);
            if (w == null) continue;
            UUID owner;
            try {
                owner = UUID.fromString(w.getString("owner", ""));
            } catch (IllegalArgumentException e) {
                continue;
            }
            Entry e = new Entry(name, owner, w.getString("owner-name", "?"), w.getString("type", "normal"), w.getLong("created"));
            worlds.put(name, e);
            if (Bukkit.getWorld(PREFIX + name) == null) {
                try {
                    creator(e).createWorld();
                } catch (Exception ex) {
                    plugin.getLogger().log(Level.WARNING, "Could not load world " + PREFIX + name, ex);
                }
            }
        }
        plugin.getLogger().info("Loaded " + worlds.size() + " own world(s)");
    }

    private void save() {
        YamlConfiguration yml = new YamlConfiguration();
        for (Entry e : worlds.values()) {
            String k = "worlds." + e.name() + ".";
            yml.set(k + "owner", e.owner().toString());
            yml.set(k + "owner-name", e.ownerName());
            yml.set(k + "type", e.type());
            yml.set(k + "created", e.created());
        }
        try {
            yml.save(file);
        } catch (IOException ex) {
            plugin.getLogger().log(Level.WARNING, "Could not save worlds.yml", ex);
        }
    }

    private static WorldCreator creator(Entry e) {
        WorldCreator c = new WorldCreator(PREFIX + e.name());
        if ("flach".equals(e.type())) c.type(WorldType.FLAT).generateStructures(false);
        return c;
    }

    // ------------------------------------------------------------------ /welt

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player p)) {
            if (args.length > 0 && args[0].equalsIgnoreCase("liste")) list(sender);
            else sender.sendMessage("Only players can use /welt (except /welt liste)");
            return true;
        }
        String sub = args.length > 0 ? args[0].toLowerCase() : "";
        switch (sub) {
            case "" , "hilfe" -> help(p);
            case "liste" -> list(p);
            case "erstellen" -> create(p, args.length > 1 ? args[1].toLowerCase() : null, args.length > 2 ? args[2].toLowerCase() : "normal");
            case "betreten" -> join(p, args.length > 1 ? args[1].toLowerCase() : null);
            case "verlassen", "zurück", "zurueck" -> leave(p);
            case "löschen", "loeschen" -> delete(p, args.length > 1 ? args[1].toLowerCase() : null,
                    args.length > 2 && args[2].equalsIgnoreCase("bestätigen") || args.length > 2 && args[2].equalsIgnoreCase("bestaetigen"));
            default -> join(p, sub);    // /welt <name>
        }
        return true;
    }

    private void help(Player p) {
        p.sendMessage(Component.text("Eigene Welten auf diesem Server:", NamedTextColor.GOLD));
        p.sendMessage(Component.text("/welt liste", NamedTextColor.YELLOW).append(Component.text(" - alle Welten", NamedTextColor.GRAY)));
        p.sendMessage(Component.text("/welt <name>", NamedTextColor.YELLOW).append(Component.text(" - in eine Welt gehen", NamedTextColor.GRAY)));
        p.sendMessage(Component.text("/welt verlassen", NamedTextColor.YELLOW).append(Component.text(" - zurück, wo du vorher warst", NamedTextColor.GRAY)));
        p.sendMessage(Component.text("/welt erstellen <name> [flach]", NamedTextColor.YELLOW).append(Component.text(" - eigene Welt anlegen", NamedTextColor.GRAY)));
        p.sendMessage(Component.text("/welt löschen <name>", NamedTextColor.YELLOW).append(Component.text(" - eigene Welt löschen", NamedTextColor.GRAY)));
        if (!p.hasPermission(PERM_CREATE) && !p.hasPermission(PERM_JOIN)) {
            p.sendMessage(Component.text("Dafür brauchst du Rechte, die du noch nicht hast.", NamedTextColor.RED));
        }
    }

    private void list(CommandSender to) {
        if (worlds.isEmpty()) {
            to.sendMessage(Component.text("Es gibt noch keine eigenen Welten.", NamedTextColor.GRAY));
            return;
        }
        to.sendMessage(Component.text("Eigene Welten:", NamedTextColor.GOLD));
        worlds.values().stream().sorted(Comparator.comparing(Entry::name)).forEach(e -> {
            World w = Bukkit.getWorld(PREFIX + e.name());
            int online = w == null ? 0 : w.getPlayers().size();
            to.sendMessage(Component.text(" " + e.name(), NamedTextColor.YELLOW)
                    .append(Component.text(" von " + e.ownerName() + (e.type().equals("flach") ? ", flach" : "")
                            + (online > 0 ? ", " + online + " drin" : ""), NamedTextColor.GRAY)));
        });
    }

    private void create(Player p, String name, String type) {
        if (!p.hasPermission(PERM_CREATE)) {
            p.sendMessage(Component.text("Du darfst keine Welten erstellen (Recht " + PERM_CREATE + ").", NamedTextColor.RED));
            return;
        }
        if (name == null || !NAME.matcher(name).matches()) {
            p.sendMessage(Component.text("Name: 3-16 Zeichen, nur a-z, 0-9 und _", NamedTextColor.RED));
            return;
        }
        if (!type.equals("normal") && !type.equals("flach")) {
            p.sendMessage(Component.text("Art: normal oder flach", NamedTextColor.RED));
            return;
        }
        if (worlds.containsKey(name) || Bukkit.getWorld(PREFIX + name) != null) {
            p.sendMessage(Component.text("Diese Welt gibt es schon.", NamedTextColor.RED));
            return;
        }
        long own = worlds.values().stream().filter(e -> e.owner().equals(p.getUniqueId())).count();
        if (own >= maxPerPlayer && !p.hasPermission(PERM_ADMIN)) {
            p.sendMessage(Component.text("Du hast schon " + own + " Welt(en), mehr geht nicht.", NamedTextColor.RED));
            return;
        }
        p.sendMessage(Component.text("Welt \"" + name + "\" wird erstellt, das dauert ein paar Sekunden ...", NamedTextColor.GRAY));
        Entry e = new Entry(name, p.getUniqueId(), p.getName(), type, System.currentTimeMillis());
        World w;
        try {
            w = creator(e).createWorld();
        } catch (Exception ex) {
            plugin.getLogger().log(Level.WARNING, "Could not create world " + PREFIX + name, ex);
            w = null;
        }
        if (w == null) {
            p.sendMessage(Component.text("Die Welt konnte nicht erstellt werden (siehe Server-Log).", NamedTextColor.RED));
            return;
        }
        worlds.put(name, e);
        save();
        plugin.getLogger().info(p.getName() + " created the world " + w.getName());
        p.sendMessage(Component.text("Welt \"" + name + "\" ist fertig! ", NamedTextColor.GREEN)
                .append(Component.text("Mit /welt " + name + " kommst du hin.", NamedTextColor.GRAY)));
        join(p, name);
    }

    private void join(Player p, String name) {
        Entry e = name == null ? null : worlds.get(name);
        if (e == null) {
            p.sendMessage(Component.text("Diese Welt gibt es nicht. /welt liste zeigt alle.", NamedTextColor.RED));
            return;
        }
        boolean owner = e.owner().equals(p.getUniqueId()) && p.hasPermission(PERM_CREATE);
        if (!owner && !p.hasPermission(PERM_JOIN)) {
            p.sendMessage(Component.text("Du darfst keine Welten betreten (Recht " + PERM_JOIN + ").", NamedTextColor.RED));
            return;
        }
        World w = Bukkit.getWorld(PREFIX + name);
        if (w == null) w = creator(e).createWorld();
        if (w == null) {
            p.sendMessage(Component.text("Die Welt konnte nicht geladen werden.", NamedTextColor.RED));
            return;
        }
        if (!isOwnWorld(p.getWorld())) back.put(p.getUniqueId(), p.getLocation());
        Location spawn = w.getSpawnLocation();
        int y = w.getHighestBlockYAt(spawn.getBlockX(), spawn.getBlockZ()) + 1;
        p.teleportAsync(new Location(w, spawn.getBlockX() + 0.5, y, spawn.getBlockZ() + 0.5)).thenAccept(ok -> {
            if (ok) p.sendMessage(Component.text("Willkommen in \"" + name + "\" von " + e.ownerName() + "! ", NamedTextColor.GREEN)
                    .append(Component.text("/welt verlassen bringt dich zurück.", NamedTextColor.GRAY)));
        });
    }

    private void leave(Player p) {
        if (!isOwnWorld(p.getWorld())) {
            p.sendMessage(Component.text("Du bist in keiner eigenen Welt.", NamedTextColor.GRAY));
            return;
        }
        p.teleportAsync(backLocation(p));
        back.remove(p.getUniqueId());
    }

    private Location backLocation(Player p) {
        Location l = back.get(p.getUniqueId());
        if (l != null && l.getWorld() != null && Bukkit.getWorld(l.getWorld().getUID()) != null) return l;
        World main = plugin.joinWorld();
        Location spawn = main.getSpawnLocation();
        return new Location(main, spawn.getBlockX() + 0.5, main.getHighestBlockYAt(spawn) + 1, spawn.getBlockZ() + 0.5);
    }

    private void delete(Player p, String name, boolean confirmed) {
        Entry e = name == null ? null : worlds.get(name);
        if (e == null) {
            p.sendMessage(Component.text("Diese Welt gibt es nicht.", NamedTextColor.RED));
            return;
        }
        boolean owner = e.owner().equals(p.getUniqueId()) && p.hasPermission(PERM_CREATE);
        if (!owner && !p.hasPermission(PERM_ADMIN)) {
            p.sendMessage(Component.text("Nur wer die Welt erstellt hat, kann sie löschen.", NamedTextColor.RED));
            return;
        }
        if (!confirmed || !name.equals(pendingDelete.get(p.getUniqueId()))) {
            pendingDelete.put(p.getUniqueId(), name);
            p.sendMessage(Component.text("Wirklich löschen? Alles darin ist dann weg! ", NamedTextColor.RED)
                    .append(Component.text("/welt löschen " + name + " bestätigen", NamedTextColor.YELLOW)));
            return;
        }
        pendingDelete.remove(p.getUniqueId());
        World w = Bukkit.getWorld(PREFIX + name);
        Path folder = worldFolder(name, w);
        if (w != null) {
            // Everyone out first, then unload
            for (Player other : new ArrayList<>(w.getPlayers())) {
                other.teleport(backLocation(other));
                other.sendMessage(Component.text("Die Welt \"" + name + "\" wurde gelöscht.", NamedTextColor.GRAY));
            }
            if (!Bukkit.unloadWorld(w, false)) {
                p.sendMessage(Component.text("Die Welt konnte nicht entladen werden, versuch es gleich nochmal.", NamedTextColor.RED));
                return;
            }
        }
        worlds.remove(name);
        save();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> deleteFolder(folder));
        plugin.getLogger().info(p.getName() + " deleted the world " + PREFIX + name);
        p.sendMessage(Component.text("Welt \"" + name + "\" gelöscht.", NamedTextColor.GREEN));
    }

    /** Paper 26 keeps extra worlds as dimensions of the main world: world/dimensions/minecraft/welt_<name>. */
    private static Path worldFolder(String name, World loaded) {
        if (loaded != null) return loaded.getWorldFolder().toPath();
        Path main = Bukkit.getWorlds().get(0).getWorldFolder().toPath();
        Path dim = main.resolve("dimensions").resolve("minecraft").resolve(PREFIX + name);
        return Files.isDirectory(dim) ? dim : Bukkit.getWorldContainer().toPath().resolve(PREFIX + name);
    }

    private void deleteFolder(Path folder) {
        if (!Files.isDirectory(folder) || !folder.getFileName().toString().startsWith(PREFIX)) return;
        try (Stream<Path> files = Files.walk(folder)) {
            for (Path f : (Iterable<Path>) files.sorted(Comparator.reverseOrder())::iterator) Files.deleteIfExists(f);
        } catch (IOException ex) {
            plugin.getLogger().log(Level.WARNING, "Could not delete " + folder, ex);
        }
    }

    static boolean isOwnWorld(World w) {
        return w != null && w.getName().startsWith(PREFIX);
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String label, String[] args) {
        List<String> out = new ArrayList<>();
        if (args.length == 1) {
            out.addAll(List.of("liste", "verlassen", "erstellen", "löschen"));
            out.addAll(worlds.keySet());
        } else if (args.length == 2 && (args[0].equalsIgnoreCase("löschen") || args[0].equalsIgnoreCase("betreten"))) {
            out.addAll(worlds.keySet());
        } else if (args.length == 3 && args[0].equalsIgnoreCase("erstellen")) {
            out.addAll(List.of("normal", "flach"));
        }
        String last = args.length == 0 ? "" : args[args.length - 1].toLowerCase();
        out.removeIf(s -> !s.startsWith(last));
        return out;
    }
}
