package de.p300.webcraft;

import de.maxhenkel.voicechat.api.BukkitVoicechatService;
import org.bukkit.plugin.Plugin;

/** Registers WebCraft with Simple Voice Chat (own class: only loaded when that plugin is there). */
final class WcVoiceBukkit {

    private WcVoiceBukkit() {
    }

    static void register(Plugin plugin) {
        BukkitVoicechatService service = plugin.getServer().getServicesManager().load(BukkitVoicechatService.class);
        if (service == null) {
            plugin.getLogger().warning("Simple Voice Chat is installed, but its service was not found");
            return;
        }
        service.registerPlugin(new WcVoiceSvc());
        plugin.getLogger().info("Voice chat: connected to Simple Voice Chat");
    }
}
