package com.trigenys.studio.auth

/** Where the session token lives between launches. Platforms provide the storage. */
interface TokenStore {
    fun token(): String?
    fun save(token: String)
    fun clear()
}

class InMemoryTokenStore(private var value: String? = null) : TokenStore {
    override fun token(): String? = value
    override fun save(token: String) { value = token }
    override fun clear() { value = null }
}
