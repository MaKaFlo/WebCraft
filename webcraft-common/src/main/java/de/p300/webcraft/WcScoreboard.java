package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.network.protocol.game.ClientboundResetScorePacket;
import net.minecraft.network.protocol.game.ClientboundSetDisplayObjectivePacket;
import net.minecraft.network.protocol.game.ClientboundSetObjectivePacket;
import net.minecraft.network.protocol.game.ClientboundSetPlayerTeamPacket;
import net.minecraft.network.protocol.game.ClientboundSetScorePacket;
import net.minecraft.world.scores.DisplaySlot;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Rebuilds the sidebar scoreboard (the "leaderboard" on the right) from the packets the server sends
 * to a WebCraft player. Works for Bukkit scoreboards and for plugins that only send packets.
 */
final class WcScoreboard {

    private record Score(int value, String display, boolean hideNumber) {}

    private static final class Team {
        String prefix = "";
        String suffix = "";
        final Set<String> members = new HashSet<>();
    }

    private final Map<String, String> objectives = new HashMap<>();
    private final Map<String, Map<String, Score>> scores = new HashMap<>();
    private final Map<String, Team> teams = new HashMap<>();
    private String sidebar = "";
    private boolean dirty;
    private String lastSent = "";

    synchronized void objective(ClientboundSetObjectivePacket p) {
        String name = p.getObjectiveName();
        if (p.getMethod() == ClientboundSetObjectivePacket.METHOD_REMOVE) {
            objectives.remove(name);
            scores.remove(name);
        } else {
            objectives.put(name, p.getDisplayName().getString());
        }
        if (name.equals(sidebar)) dirty = true;
    }

    synchronized void display(ClientboundSetDisplayObjectivePacket p) {
        if (p.getSlot() != DisplaySlot.SIDEBAR) return;
        String name = p.getObjectiveName();
        sidebar = name == null ? "" : name;
        dirty = true;
    }

    synchronized void score(ClientboundSetScorePacket p) {
        boolean hide = p.numberFormat().map(f -> f.getClass().getSimpleName().contains("Blank")).orElse(false);
        String display = p.display().map(c -> c.getString()).orElse(null);
        scores.computeIfAbsent(p.objectiveName(), k -> new HashMap<>()).put(p.owner(), new Score(p.score(), display, hide));
        if (p.objectiveName().equals(sidebar)) dirty = true;
    }

    synchronized void reset(ClientboundResetScorePacket p) {
        if (p.objectiveName() == null) {
            for (Map<String, Score> m : scores.values()) m.remove(p.owner());
        } else {
            Map<String, Score> m = scores.get(p.objectiveName());
            if (m != null) m.remove(p.owner());
        }
        dirty = true;
    }

    synchronized void team(ClientboundSetPlayerTeamPacket p) {
        if (p.getTeamAction() == ClientboundSetPlayerTeamPacket.Action.REMOVE) {
            teams.remove(p.getName());
        } else {
            Team t = teams.computeIfAbsent(p.getName(), k -> new Team());
            p.getParameters().ifPresent(par -> {
                t.prefix = par.playerPrefix().getString();
                t.suffix = par.playerSuffix().getString();
            });
            if (p.getPlayerAction() == ClientboundSetPlayerTeamPacket.Action.ADD) t.members.addAll(p.getPlayers());
            else if (p.getPlayerAction() == ClientboundSetPlayerTeamPacket.Action.REMOVE) t.members.removeAll(p.getPlayers());
        }
        dirty = true;
    }

    /** Message for the browser if the sidebar changed, else null. */
    synchronized JsonObject takeUpdate() {
        if (!dirty) return null;
        dirty = false;
        JsonObject msg = new JsonObject();
        msg.addProperty("t", "board");
        String title = objectives.get(sidebar);
        if (sidebar.isEmpty() || title == null) {
            msg.addProperty("show", false);
        } else {
            msg.addProperty("show", true);
            msg.addProperty("title", title);
            List<Map.Entry<String, Score>> list = new ArrayList<>(scores.getOrDefault(sidebar, Map.of()).entrySet());
            list.sort((a, b) -> a.getValue().value() != b.getValue().value()
                    ? Integer.compare(b.getValue().value(), a.getValue().value())
                    : a.getKey().compareToIgnoreCase(b.getKey()));
            JsonArray lines = new JsonArray();
            for (int i = 0; i < Math.min(15, list.size()); i++) {
                Map.Entry<String, Score> e = list.get(i);
                JsonObject line = new JsonObject();
                line.addProperty("text", lineText(e.getKey(), e.getValue()));
                if (!e.getValue().hideNumber()) line.addProperty("score", e.getValue().value());
                lines.add(line);
            }
            msg.add("lines", lines);
        }
        String key = msg.toString();
        if (key.equals(lastSent)) return null;
        lastSent = key;
        return msg;
    }

    private String lineText(String owner, Score s) {
        String text = owner;
        if (s.display() != null) text = s.display();
        else {
            for (Team t : teams.values()) {
                if (t.members.contains(owner)) {
                    text = t.prefix + owner + t.suffix;
                    break;
                }
            }
        }
        return text.replaceAll("§.", "");   // old-style color codes used as invisible line ids
    }
}
