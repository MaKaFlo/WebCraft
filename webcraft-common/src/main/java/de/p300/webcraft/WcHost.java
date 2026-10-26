package de.p300.webcraft;

import com.google.gson.JsonObject;

import java.util.logging.Logger;

/** What the shared WebSocket code needs from the server side (Paper plugin or Fabric mod). */
public interface WcHost {

    /** A message from a browser (main thread). */
    void handleMessage(WcSession s, JsonObject json);

    /** The browser connection is gone (main thread). */
    void handleDisconnect(WcSession s);

    /** Run on the main server thread; dropped while the server or plugin shuts down. */
    void runSync(Runnable r);

    Logger logger();
}
