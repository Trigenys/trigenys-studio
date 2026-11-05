package com.trigenys.studio.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** Root composable: one model, one screen at a time. */
@Composable
fun App(model: AppModel) {
    val state by model.state.collectAsState()
    StudioTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when {
                state.booting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                state.screen is Screen.SignIn -> SignInScreen(state.signIn, model)
                state.screen is Screen.Task -> TaskScreen(state, model)
                else -> DayScreen(state, model)
            }
        }
    }
}
