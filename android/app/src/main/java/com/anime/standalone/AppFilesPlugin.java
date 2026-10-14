package com.anime.standalone;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
@CapacitorPlugin(name="AppFiles")
public class AppFilesPlugin extends Plugin {
    @PluginMethod public void share(PluginCall call) {
        String name=call.getString("name","anime.json");
        String text=call.getString("text","");
        if(name==null || !name.matches("[A-Za-z0-9._-]{1,100}\\.json") || text==null || text.length()>8*1024*1024) { call.reject("文件无效或过大"); return; }
        getActivity().runOnUiThread(() -> {
            try {
                File directory=new File(getContext().getCacheDir(),"exports");
                if(!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建分享文件");
                File file=new File(directory,name);
                try (FileOutputStream output=new FileOutputStream(file)) { output.write(text.getBytes(StandardCharsets.UTF_8)); }
                Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
                Intent intent=new Intent(Intent.ACTION_SEND);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_STREAM,uri);
                intent.setClipData(ClipData.newRawUri(name,uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(intent,"分享文件"));
                call.resolve();
            } catch(Exception error) { call.reject(error.getMessage()); }
        });
    }
}