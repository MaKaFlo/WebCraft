package de.p300.webcraft;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;

/** Item -> small JSON object for the browser: { k: key, c: count, d: damage 0..1, e: enchanted }. */
final class WcItems {

    private WcItems() {}

    static JsonElement json(ItemStack s) {
        if (s == null || s.getType().isAir() || s.getAmount() <= 0) return JsonNull.INSTANCE;
        JsonObject o = new JsonObject();
        o.addProperty("k", s.getType().getKey().getKey());
        o.addProperty("c", s.getAmount());
        short max = s.getType().getMaxDurability();
        if (max > 0 && s.hasItemMeta()) {
            ItemMeta meta = s.getItemMeta();
            if (meta instanceof Damageable d && d.hasDamage()) {
                o.addProperty("d", Math.round(100.0 * d.getDamage() / max) / 100.0);
            }
        }
        if (!s.getEnchantments().isEmpty()) o.addProperty("e", true);
        return o;
    }
}
