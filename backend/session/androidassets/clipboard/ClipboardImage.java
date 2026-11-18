// Runs alongside uniTerm's pinned scrcpy server in the authenticated ADB shell.
package org.uniterm.clipboard;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentProviderClient;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.UUID;

public final class ClipboardImage {
    public static void main(String[] args) {
        try {
            if (Build.VERSION.SDK_INT < 29) throw new UnsupportedOperationException();
            Looper.prepareMainLooper();
            Class.forName("com.genymobile.scrcpy.Workarounds").getMethod("apply").invoke(null);
            Context context = (Context) Class.forName("com.genymobile.scrcpy.FakeContext").getMethod("get").invoke(null);
            put(context, args[0], args[1]);
            System.out.println("UNITERM_CLIPBOARD_OK");
        } catch (Exception e) {
            System.err.println("Clipboard image failed: " + e.getClass().getSimpleName());
            System.exit(1);
        }
    }

    private static void put(Context context, String path, String mime) throws Exception {
        boolean png = "image/png".equals(mime);
        if (!png && !"image/jpeg".equals(mime)) throw new IllegalArgumentException("MIME");
        ContentResolver resolver = context.getContentResolver();
        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "clipboard-" + UUID.randomUUID() + (png ? ".png" : ".jpg"));
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/uniTerm/");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        try (ContentProviderClient provider = resolver.acquireContentProviderClient(collection)) {
            if (provider == null) throw new IllegalStateException("MediaStore");
            Uri uri = provider.insert(collection, values);
            if (uri == null) throw new IllegalStateException("insert");
            boolean copied = false;
            try {
                try (FileInputStream input = new FileInputStream(path);
                     OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(provider.openFile(uri, "w"))) {
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                if (provider.update(uri, values, null, null) != 1) throw new IllegalStateException("publish");
                ClipboardManager manager = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                manager.setPrimaryClip(new ClipData("uniTerm", new String[]{mime}, new ClipData.Item(uri)));
                copied = true;
            } finally {
                if (!copied) provider.delete(uri, null, null);
            }
        }
    }
}
