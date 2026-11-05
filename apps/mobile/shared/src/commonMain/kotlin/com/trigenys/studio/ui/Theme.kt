package com.trigenys.studio.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Same tokens as apps/web/src/styles.css: dark surface, indigo accent.
private val Scheme: ColorScheme = darkColorScheme(
    primary = Color(0xFF9DA4FF),
    onPrimary = Color(0xFF0D0E12),
    primaryContainer = Color(0xFF6366F1),
    onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Color(0xFFA1A1AA),
    background = Color(0xFF0D0E12),
    onBackground = Color(0xFFE4E4E7),
    surface = Color(0xFF15171E),
    onSurface = Color(0xFFE4E4E7),
    surfaceVariant = Color(0xFF1C1F28),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF2A2E3A),
    error = Color(0xFFF87171),
    onError = Color(0xFF0D0E12),
)

@Composable
fun StudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
