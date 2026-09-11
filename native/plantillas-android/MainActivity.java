package com.chorapp.ama;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CompartidoPlugin.class);
        super.onCreate(savedInstanceState);
        CompartidoPlugin.manejarIntent(this, getIntent(), null);
    }

    // La app puede estar ya abierta y recibir OTRO "compartir" (singleTask):
    // en ese caso llega aquí en vez de por onCreate.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        CompartidoPlugin instancia = null;
        PluginHandle h = getBridge() != null ? getBridge().getPlugin("Compartido") : null;
        if (h != null) instancia = (CompartidoPlugin) h.getInstance();
        CompartidoPlugin.manejarIntent(this, intent, instancia);
    }
}
