package com.trigenys.studio.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MagicLinkTest {
    @Test
    fun extracts_token_from_verify_link() {
        val link = "https://api.example.com/api/auth/magic-link/verify?token=AbC123_xyz-0987654321&callbackURL=%2Ftoday"
        assertEquals("AbC123_xyz-0987654321", MagicLink.tokenFrom(link))
    }

    @Test
    fun accepts_a_bare_token_and_ignores_surrounding_whitespace() {
        assertEquals("AbC123_xyz-0987654321", MagicLink.tokenFrom("  AbC123_xyz-0987654321\n"))
    }

    @Test
    fun rejects_links_without_a_token() {
        assertNull(MagicLink.tokenFrom(""))
        assertNull(MagicLink.tokenFrom("https://api.example.com/today"))
        assertNull(MagicLink.tokenFrom("https://api.example.com/verify?callbackURL=x&token="))
    }
}
