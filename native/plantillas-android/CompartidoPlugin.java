package com.chorapp.ama;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

// Plugin propio de ChorApp (no es del ecosistema Capacitor): recibe lo que
// Maite comparte desde otra app (WhatsApp, Galería…) con "Compartir con
// ChorApp". Ver src/js/compartido.js para el lado web.
//
// El archivo compartido llega como una Uri de content:// que solo vive
// mientras dura el Intent, así que se copia YA a la caché de la app y se
// entrega esa ruta absoluta (comoArchivo() en JS la lee con Filesystem).
@CapacitorPlugin(name = "Compartido")
public class CompartidoPlugin extends Plugin {

    // Estático: si la app arranca en frío por el share, el intent llega
    // antes de que Capacitor termine de registrar el plugin.
    private static JSObject pendiente = null;

    public static void manejarIntent(Context ctx, Intent intent, CompartidoPlugin instancia) {
        if (intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        String mime = intent.getType();
        if (mime == null) return;

        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;

        try {
            String nombre = "compartido";
            Cursor c = ctx.getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (i >= 0 && c.getString(i) != null) nombre = c.getString(i);
                    }
                } finally {
                    c.close();
                }
            }

            File destino = new File(ctx.getCacheDir(), "compartido_" + System.currentTimeMillis() + "_" + nombre);
            InputStream in = ctx.getContentResolver().openInputStream(uri);
            if (in == null) return;
            FileOutputStream out = new FileOutputStream(destino);
            byte[] buffer = new byte[8192];
            int leido;
            while ((leido = in.read(buffer)) != -1) out.write(buffer, 0, leido);
            in.close();
            out.close();

            JSObject datos = new JSObject();
            datos.put("nombre", nombre);
            datos.put("mime", mime);
            datos.put("ruta", destino.getAbsolutePath());

            pendiente = datos;
            if (instancia != null) instancia.notifyListeners("recibido", datos);
        } catch (Exception e) {
            // Si algo falla simplemente no llega nada a la web: no rompe el arranque.
        }
    }

    // La web lo llama una vez al arrancar, por si la app se abrió por un share.
    @PluginMethod
    public void obtenerPendiente(PluginCall call) {
        if (pendiente != null) {
            call.resolve(pendiente);
            pendiente = null;
        } else {
            call.resolve(new JSObject());
        }
    }
}
