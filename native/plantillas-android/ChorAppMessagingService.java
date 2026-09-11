package com.chorapp.ama;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// El SDK de FCM solo pinta la notificación "de fábrica" (una línea, sin
// BigTextStyle) cuando la app está cerrada o en segundo plano. Por eso el
// Worker manda "data" en vez de "notification": así SIEMPRE pasa por aquí y
// controlamos el estilo, para que el texto completo se vea al desplegarla.
public class ChorAppMessagingService extends FirebaseMessagingService {

    private static final String CANAL_ID = "chorapp";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String titulo = data.get("title");
        String cuerpo = data.get("body");
        if (titulo == null || titulo.isEmpty()) titulo = "ChorApp";
        if (cuerpo == null || cuerpo.isEmpty()) return;

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CANAL_ID)
                .setSmallIcon(R.drawable.ic_stat_bihotsak)
                .setColor(Color.parseColor("#1512D6"))
                .setContentTitle(titulo)
                .setContentText(cuerpo)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(cuerpo))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH);

        NotificationManagerCompat.from(this)
                .notify((int) System.currentTimeMillis(), builder.build());
    }
}
