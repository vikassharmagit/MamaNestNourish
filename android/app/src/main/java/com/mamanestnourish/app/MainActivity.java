package com.mamanestnourish.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WebView webView = this.bridge.getWebView();
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.addJavascriptInterface(new Object() {
                    @JavascriptInterface
                    public void print() {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                createWebPrintJob(webView);
                            }
                        });
                    }

                    @JavascriptInterface
                    public void downloadFile(String base64Data, String fileName, String mimeType) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                handleDownloadAndShare(base64Data, fileName, mimeType);
                            }
                        });
                    }
                }, "AndroidInterface");
            }
        });
    }

    private void createWebPrintJob(WebView webView) {
        PrintManager printManager = (PrintManager) this.getSystemService(Context.PRINT_SERVICE);
        PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter("MamaNestNourish Plan");
        String jobName = "MamaNestNourish Plan";
        printManager.print(jobName, printAdapter, new PrintAttributes.Builder().build());
    }

    private void handleDownloadAndShare(String base64Data, String fileName, String mimeType) {
        try {
            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
            
            // 1. Try to save to the public Downloads folder using MediaStore (Android 10+)
            boolean savedToDownloads = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContentResolver();
                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                contentValues.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues);
                if (uri != null) {
                    try (OutputStream outputStream = resolver.openOutputStream(uri)) {
                        if (outputStream != null) {
                            outputStream.write(fileBytes);
                            savedToDownloads = true;
                        }
                    }
                }
            } else {
                // Fallback for older Android versions
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (downloadsDir.exists() || downloadsDir.mkdirs()) {
                    File file = new File(downloadsDir, fileName);
                    try (FileOutputStream fos = new FileOutputStream(file)) {
                        fos.write(fileBytes);
                        savedToDownloads = true;
                    }
                }
            }
            
            // 2. Save a copy in cache to trigger the share sheet
            File cacheFile = new File(getCacheDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                fos.write(fileBytes);
            }
            
            if (savedToDownloads) {
                Toast.makeText(this, "Plan downloaded to Downloads folder", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "Saving plan...", Toast.LENGTH_SHORT).show();
            }
            
            // 3. Share the file so the user can print, view, or send it anywhere
            Uri fileUri = FileProvider.getUriForFile(
                this, 
                getPackageName() + ".fileprovider", 
                cacheFile
            );
            
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            Intent chooser = Intent.createChooser(shareIntent, "Save or print plan");
            startActivity(chooser);
            
        } catch (Exception e) {
            Toast.makeText(this, "Failed to download plan: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}

