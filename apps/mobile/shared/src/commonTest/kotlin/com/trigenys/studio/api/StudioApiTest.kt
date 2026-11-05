package com.trigenys.studio.api

import com.trigenys.studio.auth.InMemoryTokenStore
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StudioApiTest {
    private val detail = """
        {"id":"t1","productId":"insight","type":"post","title":"Titre","brief":"","state":"awaiting_approval",
         "priority":1,"dueAt":null,"assigneeId":null,"version":2,"createdBy":"u","createdAt":"2026-01-01T00:00:00Z",
         "updatedAt":"2026-01-01T00:00:00Z","latestVersion":null,"latestApproval":null,"approvalValid":false,
         "allowedTransitions":["approved","rejected"],"someFutureField":42}
    """.trimIndent()

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(tokens: InMemoryTokenStore = InMemoryTokenStore("tok"), handler: suspend (HttpRequestData) -> Pair<HttpStatusCode, String>) =
        StudioApi(
            "https://api.test/",
            tokens,
            MockEngine { request ->
                requests += request
                val (status, body) = handler(request)
                val type = if (status.value >= 400) "application/problem+json" else "application/json"
                respond(body, status, headersOf(HttpHeaders.ContentType, type))
            },
        )

    @Test
    fun sends_bearer_token_and_tolerates_unknown_fields() = runTest {
        val api = api { HttpStatusCode.OK to detail }
        val t = api.task("t1")
        assertEquals(TaskState.AWAITING_APPROVAL, t.state)
        assertEquals(listOf(TaskState.APPROVED, TaskState.REJECTED), t.allowedTransitions)
        assertEquals("Bearer tok", requests.single().headers[HttpHeaders.Authorization])
        assertEquals("https://api.test/tasks/t1", requests.single().url.toString())
    }

    @Test
    fun mutations_carry_a_fresh_idempotency_key_each_time() = runTest {
        val api = api { HttpStatusCode.Created to detail }
        api.decide("t1", "approved", "ok")
        api.transition("t1", TaskState.NEEDS_FIX, "motif")
        val keys = requests.map { it.headers["Idempotency-Key"] }
        assertTrue(keys.all { it != null && it.length >= 32 })
        assertNotEquals(keys[0], keys[1])
        val body = (requests[0].body as io.ktor.http.content.TextContent).text
        assertTrue(body.contains("\"decision\":\"approved\""), body)
        val transition = (requests[1].body as io.ktor.http.content.TextContent).text
        assertTrue(transition.contains("\"to\":\"needs_fix\""), transition)
    }

    @Test
    fun problem_details_become_an_api_exception() = runTest {
        val api = api { HttpStatusCode.Forbidden to """{"type":"about:blank","title":"Forbidden","status":403,"detail":"content.review requis"}""" }
        val e = assertFailsWith<ApiException> { api.decide("t1", "approved") }
        assertEquals(403, e.status)
        assertEquals("Forbidden", e.title)
        assertEquals("content.review requis", e.detail)
    }

    @Test
    fun magic_link_verification_keeps_the_session_token() = runTest {
        val tokens = InMemoryTokenStore(null)
        val api = StudioApi(
            "https://api.test",
            tokens,
            MockEngine { request ->
                requests += request
                respond("{}", HttpStatusCode.OK, headersOf("set-auth-token" to listOf("session-123"), HttpHeaders.ContentType to listOf("application/json")))
            },
        )
        assertNull(tokens.token())
        api.verifyMagicLink("abc")
        assertEquals("session-123", tokens.token())
        assertTrue(requests.single().url.toString().startsWith("https://api.test/api/auth/magic-link/verify?token=abc"))
        assertNotNull(api.signedIn)
        api.signOut()
        assertNull(tokens.token())
    }
}
