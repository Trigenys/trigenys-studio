package com.trigenys.studio.api

import com.trigenys.studio.auth.TokenStore
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** An API error, carrying the Problem Details the Worker returned. */
class ApiException(val status: Int, val title: String, val detail: String?) : Exception(detail ?: title)

/**
 * Typed client for the Studio Worker. Business rules stay server-side: the
 * client only forwards what the user asked and shows what the server allows.
 */
class StudioApi(
    baseUrl: String,
    private val tokens: TokenStore,
    engine: HttpClientEngine? = null,
) {
    private val base = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val http: HttpClient = (engine?.let { HttpClient(it) } ?: HttpClient()).config {
        install(ContentNegotiation) { json(json) }
        expectSuccess = false
    }

    val signedIn: Boolean get() = tokens.token() != null

    suspend fun me(): Me = get("/me").body()
    suspend fun products(): List<Product> = get("/products").body()
    suspend fun tasks(productId: String? = null): List<Task> =
        get("/tasks") { if (productId != null) parameter("productId", productId) }.body()

    suspend fun task(id: String): TaskDetail = get("/tasks/$id").body()
    suspend fun comments(id: String): List<Comment> = get("/tasks/$id/comments").body()
    suspend fun transitions(id: String): List<TaskTransition> = get("/tasks/$id/transitions").body()

    suspend fun addComment(id: String, body: String): Comment =
        post("/tasks/$id/comments", json.encodeToString(CreateComment(body)), idempotent = true).body()

    suspend fun transition(id: String, to: TaskState, reason: String? = null): TaskDetail =
        post("/tasks/$id/transitions", json.encodeToString(RequestTransition(to, reason)), idempotent = true).body()

    suspend fun decide(id: String, decision: String, comment: String? = null): TaskDetail =
        post("/tasks/$id/approvals", json.encodeToString(DecideApproval(decision, comment)), idempotent = true).body()

    // --- Better Auth (magic link + bearer plugin) ---

    /** Asks the server to e-mail a magic link; the link lands in the app (App Link) or is pasted. */
    suspend fun requestMagicLink(email: String, callbackUrl: String? = null) {
        post("/api/auth/sign-in/magic-link", json.encodeToString(MagicLinkRequest(email, callbackUrl)))
    }

    /** Exchanges the link's token for a session token, which is kept for later calls. */
    suspend fun verifyMagicLink(token: String): String {
        val response = get("/api/auth/magic-link/verify") { parameter("token", token) }
        val session = response.headers["set-auth-token"]
            ?: runCatching { json.decodeFromString<SessionResponse>(response.bodyAsText()).token }.getOrNull()
            ?: throw ApiException(response.status.value, "Jeton de session absent", null)
        tokens.save(session)
        return session
    }

    suspend fun signOut() {
        runCatching { post("/api/auth/sign-out", "{}") }
        tokens.clear()
    }

    private suspend fun get(path: String, block: HttpRequestBuilder.() -> Unit = {}): HttpResponse =
        send(HttpMethod.Get, path, null, false, block)

    private suspend fun post(path: String, body: String?, idempotent: Boolean = false): HttpResponse =
        send(HttpMethod.Post, path, body, idempotent) {}

    @OptIn(ExperimentalUuidApi::class)
    private suspend fun send(
        method: HttpMethod,
        path: String,
        body: String?,
        idempotent: Boolean,
        block: HttpRequestBuilder.() -> Unit,
    ): HttpResponse {
        val response = http.request(base + path) {
            this.method = method
            tokens.token()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            if (idempotent) header("Idempotency-Key", Uuid.random().toString())
            block()
        }
        if (response.status.value >= 400) throw problemOf(response)
        return response
    }

    private suspend fun problemOf(response: HttpResponse): ApiException {
        val text = response.bodyAsText()
        val problem = runCatching { json.decodeFromString<Problem>(text) }.getOrNull()
        return ApiException(response.status.value, problem?.title ?: response.status.description, problem?.detail)
    }
}
