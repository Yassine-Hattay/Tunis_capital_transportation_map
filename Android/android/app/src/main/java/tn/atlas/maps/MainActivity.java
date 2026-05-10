package tn.atlas.maps;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the Valhalla plugin BEFORE super.onCreate()
        registerPlugin(ValhallaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}