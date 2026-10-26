package de.p300.webcraft;

import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.chunk.PalettedContainer;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;

/**
 * Turns a chunk into the binary message the browser understands.
 *
 * Layout: byte 0 = message type (1 = chunk), rest is zlib-deflated:
 *   int32 chunkX, int32 chunkZ, uint8 sectionCount,
 *   per section: int8 sectionY (world y >> 4), 4096 x uint16 little-endian palette ids,
 *   block index = (y * 16 + z) * 16 + x.
 */
public final class ChunkEncoder {

    public static final byte TYPE_CHUNK = 1;

    /** Copy of one 16x16x16 section, taken on the main thread and read on a worker thread. */
    public record Section(int sectionY, PalettedContainer<BlockState> states) {}

    private ChunkEncoder() {}

    /** Main thread: copy the non-empty sections of a loaded chunk. */
    public static List<Section> copy(ChunkAccess chunk) {
        List<Section> out = new ArrayList<>();
        LevelChunkSection[] sections = chunk.getSections();
        for (int i = 0; i < sections.length; i++) {
            LevelChunkSection s = sections[i];
            if (s == null || s.hasOnlyAir()) continue;
            out.add(new Section(chunk.getSectionYFromSectionIndex(i), s.getStates().copy()));
        }
        return out;
    }

    /** Worker thread: encode the copied sections. */
    public static byte[] encode(int cx, int cz, List<Section> sections, BlockPalette palette) throws IOException {
        byte[] sectionBuf = new byte[4096 * 2];
        ByteArrayOutputStream raw = new ByteArrayOutputStream(64 * 1024);
        DataOutputStream out = new DataOutputStream(raw);
        out.writeInt(cx);
        out.writeInt(cz);
        out.writeByte(sections.size());
        for (Section s : sections) {
            int i = 0;
            for (int y = 0; y < 16; y++) {
                for (int z = 0; z < 16; z++) {
                    for (int x = 0; x < 16; x++) {
                        int id = palette.idOf(s.states().get(x, y, z));
                        sectionBuf[i++] = (byte) (id & 0xFF);
                        sectionBuf[i++] = (byte) ((id >> 8) & 0xFF);
                    }
                }
            }
            out.writeByte(s.sectionY());
            out.write(sectionBuf);
        }
        out.flush();

        ByteArrayOutputStream result = new ByteArrayOutputStream(raw.size() / 4 + 16);
        result.write(TYPE_CHUNK);
        Deflater deflater = new Deflater(Deflater.BEST_SPEED);
        try (DeflaterOutputStream dos = new DeflaterOutputStream(result, deflater)) {
            raw.writeTo(dos);
        } finally {
            deflater.end();
        }
        return result.toByteArray();
    }
}
