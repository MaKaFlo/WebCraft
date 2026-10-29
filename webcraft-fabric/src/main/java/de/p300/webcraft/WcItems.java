package de.p300.webcraft;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;

/** Item -> small JSON object for the browser: { k: key, c: count, d: damage 0..1, e: enchanted }. */
final class WcItems {

    private WcItems() {}

    static String key(ItemStack s) {
        return BuiltInRegistries.ITEM.getKey(s.getItem()).getPath();
    }

    static JsonElement json(ItemStack s) {
        if (s == null || s.isEmpty()) return JsonNull.INSTANCE;
        JsonObject o = new JsonObject();
        o.addProperty("k", key(s));
        o.addProperty("c", s.getCount());
        if (s.isDamageableItem() && s.getDamageValue() > 0) {
            o.addProperty("d", Math.round(100.0 * s.getDamageValue() / s.getMaxDamage()) / 100.0);
        }
        // Enchantments (also the stored ones of enchanted books) as [key, level] for the tooltip
        com.google.gson.JsonArray list = new com.google.gson.JsonArray();
        for (var comp : java.util.List.of(net.minecraft.core.component.DataComponents.ENCHANTMENTS, net.minecraft.core.component.DataComponents.STORED_ENCHANTMENTS)) {
            var ench = s.get(comp);
            if (ench == null) continue;
            for (var e : ench.entrySet()) {
                e.getKey().unwrapKey().ifPresent(k -> {
                    com.google.gson.JsonArray a = new com.google.gson.JsonArray();
                    a.add(k.identifier().getPath());
                    a.add(e.getIntValue());
                    list.add(a);
                });
            }
        }
        if (!list.isEmpty()) {
            o.addProperty("e", true);
            o.add("en", list);
        }
        return o;
    }
}
