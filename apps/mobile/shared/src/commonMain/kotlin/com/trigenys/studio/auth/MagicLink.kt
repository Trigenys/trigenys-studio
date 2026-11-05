package com.trigenys.studio.auth

object MagicLink {
    private val TOKEN = Regex("^[A-Za-z0-9_-]{16,}$")

    /**
     * Extracts the token from a magic link such as
     * `https://api.example/api/auth/magic-link/verify?token=abc&callbackURL=...`.
     * A bare token pasted by the user is accepted too.
     */
    fun tokenFrom(input: String): String? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (TOKEN.matches(text)) return text
        val query = text.substringAfter('?', "").substringBefore('#')
        return query.split('&')
            .map { it.substringBefore('=') to it.substringAfter('=', "") }
            .firstOrNull { (k, _) -> k == "token" }
            ?.second
            ?.takeIf { it.isNotEmpty() }
    }
}
