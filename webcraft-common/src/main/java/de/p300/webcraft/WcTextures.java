package de.p300.webcraft;

import com.google.gson.JsonObject;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Logger;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * The server texture pack for WebCraft players: plugins/WebCraft/texturen.zip with block/NAME.png and item/NAME.png.
 * Every WebCraft player gets it when joining (Minecraft players keep their own look).
 */
final class WcTextures {

    static final int MAX_SIZE = 32;
    static final int MAX_ZIP_BYTES = 16 * 1024 * 1024;
    private static final Pattern PATH = Pattern.compile("(block|item)/[a-z0-9_]{1,64}\\.png");
    private static final Pattern ENTRY = Pattern.compile("(?:^|/)(block|item)s?/([a-z0-9_]{1,64})\\.png(\\.mcmeta)?$");

    private final File file;
    private final Logger log;
    private volatile JsonObject message;   // ready-made "pack" message, null if there is no pack

    WcTextures(File dataFolder, Logger log) {
        this.file = new File(dataFolder, "texturen.zip");
        this.log = log;
    }

    File file() {
        return file;
    }

    /** (Re)reads the zip. Returns the number of textures. */
    int load() {
        if (!file.isFile()) {
            message = null;
            return 0;
        }
        try {
            Map<String, String> files = read(Files.readAllBytes(file.toPath()));
            message = toMessage(files);
            log.info("Loaded " + files.size() + " WebCraft textures from " + file.getName());
            return files.size();
        } catch (IOException e) {
            log.warning("Could not read " + file.getName() + ": " + e.getMessage());
            message = null;
            return 0;
        }
    }

    /** Message for a browser, or null when the server has no pack. */
    JsonObject message() {
        return message;
    }

    /** Stores an uploaded pack (from the texture studio of an admin). Returns the number of textures. */
    int save(byte[] zip) throws IOException {
        if (zip.length > MAX_ZIP_BYTES) throw new IOException("pack too big");
        Map<String, String> files = read(zip);
        if (files.isEmpty()) {
            Files.deleteIfExists(file.toPath());
            message = null;
            return 0;
        }
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), zip);
        message = toMessage(files);
        return files.size();
    }

    private JsonObject toMessage(Map<String, String> files) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "pack");
        JsonObject f = new JsonObject();
        files.forEach(f::addProperty);
        m.add("files", f);
        if (animations != null) m.add("anims", animations);
        return m;
    }

    private JsonObject animations;

    /** Animation timing from a Minecraft ".png.mcmeta" file. */
    private void readMcmeta(String path, byte[] data) {
        try {
            JsonObject anim = com.google.gson.JsonParser.parseString(new String(data, java.nio.charset.StandardCharsets.UTF_8))
                    .getAsJsonObject().getAsJsonObject("animation");
            if (anim == null) return;
            JsonObject a = new JsonObject();
            a.addProperty("t", anim.has("frametime") ? anim.get("frametime").getAsInt() : 1);
            if (anim.has("frames")) {
                com.google.gson.JsonArray frames = new com.google.gson.JsonArray();
                for (var f : anim.getAsJsonArray("frames")) {
                    frames.add(f.isJsonObject() ? f.getAsJsonObject().get("index").getAsInt() : f.getAsInt());
                }
                a.add("f", frames);
            }
            if (animations == null) animations = new JsonObject();
            animations.add(path, a);
        } catch (RuntimeException e) {
            // not a valid animation file, ignore
        }
    }

    /** Reads all valid textures of a zip, scaled down to at most 32x32, as base64 PNG. */
    private Map<String, String> read(byte[] zip) throws IOException {
        Map<String, String> out = new LinkedHashMap<>();
        animations = null;
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry e;
            while ((e = in.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                String name = e.getName().replace('\\', '/').toLowerCase();
                if (name.endsWith("animations.json")) {
                    // Timing of animated textures (fire, water ...): {"block/fire": {"t": 2, "f": [0, 1, ...]}}
                    try {
                        animations = com.google.gson.JsonParser.parseString(new String(in.readNBytes(1024 * 1024),
                                java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
                    } catch (RuntimeException ex) {
                        log.warning("Ignoring broken animations.json: " + ex.getMessage());
                    }
                    continue;
                }
                // WebCraft packs ("block/x.png") and normal Minecraft resource packs
                // ("assets/minecraft/textures/block/x.png", old ones "textures/blocks/x.png")
                java.util.regex.Matcher m = ENTRY.matcher(name);
                if (!m.find()) continue;
                String path = m.group(1) + "/" + m.group(2) + ".png";
                if (!PATH.matcher(path).matches()) continue;
                if (m.group(3) != null) {
                    readMcmeta(path.substring(0, path.length() - 4), in.readNBytes(64 * 1024));
                    continue;
                }
                byte[] data = in.readNBytes(4 * 1024 * 1024);
                try {
                    BufferedImage img = ImageIO.read(new ByteArrayInputStream(data));
                    if (img == null) continue;
                    out.put(path.substring(0, path.length() - 4), Base64.getEncoder().encodeToString(png(shrink(img))));
                } catch (IOException | RuntimeException ex) {
                    log.warning("Skipping texture " + path + ": " + ex.getMessage());
                }
            }
        }
        return out;
    }

    private static BufferedImage shrink(BufferedImage img) {
        // Animation strip (frames stacked from top to bottom): keep all frames, at most 32 px wide
        if (img.getHeight() > img.getWidth() && img.getHeight() % img.getWidth() == 0) {
            int w = img.getWidth(), frames = Math.min(64, img.getHeight() / w);
            int size = Math.min(MAX_SIZE, w);
            BufferedImage out = new BufferedImage(size, size * frames, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = out.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.drawImage(img, 0, 0, size, size * frames, 0, 0, w, w * frames, null);
            g.dispose();
            return out;
        }
        int side = Math.min(img.getWidth(), img.getHeight());
        int size = Math.min(MAX_SIZE, side);
        if (img.getWidth() == size && img.getHeight() == size && img.getType() == BufferedImage.TYPE_INT_ARGB) return img;
        BufferedImage out = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        int x0 = (img.getWidth() - side) / 2, y0 = (img.getHeight() - side) / 2;
        g.drawImage(img, 0, 0, size, size, x0, y0, x0 + side, y0 + side, null);
        g.dispose();
        return out;
    }

    private static byte[] png(BufferedImage img) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(img, "png", bytes);
        return bytes.toByteArray();
    }
}
