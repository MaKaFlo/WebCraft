package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;

import java.util.Optional;

/** Chat components into parts for the browser: text, color, styles, what a click does and the hover text. */
final class WcChat {

    private WcChat() {
    }

    static JsonArray parts(Component c) {
        JsonArray out = new JsonArray();
        c.visit((style, text) -> {
            if (!text.isEmpty()) out.add(part(style, text));
            return Optional.empty();
        }, Style.EMPTY);
        return out;
    }

    /** Anything more than plain white text (else the plain line is enough). */
    static boolean styled(JsonArray parts) {
        for (var p : parts) if (p.getAsJsonObject().size() > 1) return true;
        return false;
    }

    private static JsonObject part(Style style, String text) {
        JsonObject o = new JsonObject();
        o.addProperty("x", text);
        TextColor color = style.getColor();
        if (color != null && color.getValue() != 0xFFFFFF) o.addProperty("c", String.format("#%06x", color.getValue()));
        if (style.isBold()) o.addProperty("b", true);
        if (style.isItalic()) o.addProperty("i", true);
        if (style.isUnderlined()) o.addProperty("u", true);
        if (style.isStrikethrough()) o.addProperty("s", true);
        if (style.isObfuscated()) o.addProperty("o", true);
        ClickEvent click = style.getClickEvent();
        String[] k = switch (click) {
            case ClickEvent.RunCommand r -> new String[] {"run", r.command()};
            case ClickEvent.SuggestCommand s -> new String[] {"suggest", s.command()};
            case ClickEvent.OpenUrl u -> new String[] {"url", u.uri().toString()};
            case ClickEvent.CopyToClipboard cp -> new String[] {"copy", cp.value()};
            case null, default -> null;
        };
        if (k != null) {
            JsonArray a = new JsonArray();
            a.add(k[0]);
            a.add(k[1]);
            o.add("k", a);
        }
        if (style.getHoverEvent() instanceof HoverEvent.ShowText show) o.addProperty("h", show.value().getString());
        return o;
    }
}
