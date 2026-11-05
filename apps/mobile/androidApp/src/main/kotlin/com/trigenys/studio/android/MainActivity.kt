package com.trigenys.studio.android

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.trigenys.studio.api.StudioApi
import com.trigenys.studio.auth.TokenStore
import com.trigenys.studio.ui.App
import com.trigenys.studio.ui.AppModel

class MainActivity : ComponentActivity() {
    private lateinit var model: AppModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model = AppModel(StudioApi(BuildConfig.API_URL, PrefsTokenStore(applicationContext)))
        handleLink(intent)
        setContent { App(model) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** A magic link opened on the phone lands here through the App Link filter. */
    private fun handleLink(intent: Intent?) {
        val uri = intent?.data?.toString() ?: return
        if (intent.action == Intent.ACTION_VIEW) model.openLink(uri)
    }
}

/** Session token in app-private preferences; cleared on sign-out. */
class PrefsTokenStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("studio-session", Context.MODE_PRIVATE)
    override fun token(): String? = prefs.getString("token", null)
    override fun save(token: String) { prefs.edit().putString("token", token).apply() }
    override fun clear() { prefs.edit().remove("token").apply() }
}
