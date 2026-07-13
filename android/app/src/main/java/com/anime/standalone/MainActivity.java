package com.anime.standalone;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        boolean night =
            (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int barColor = Color.parseColor(night ? "#0B0D12" : "#F3F5F8");
        getWindow().setStatusBarColor(barColor);
        getWindow().setNavigationBarColor(barColor);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            // true = dark icons for light bars
            controller.setAppearanceLightStatusBars(!night);
            controller.setAppearanceLightNavigationBars(!night);
        }
    }
}
