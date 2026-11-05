package com.trigenys.studio.android

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.trigenys.studio.api.StudioApi
import com.trigenys.studio.auth.InMemoryTokenStore
import com.trigenys.studio.domain.ViewContext
import com.trigenys.studio.ui.AppModel
import com.trigenys.studio.ui.DayScreen
import com.trigenys.studio.ui.StudioTheme
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.datetime.TimeZone
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

@OptIn(ExperimentalTime::class)
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class DayScreenScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val me = """{"userId":"u-me","email":"op@example.com","name":"Opératrice","grants":[{"role":"reviewer","productId":null}]}"""
    private val products = """[{"id":"insight","name":"Trigenys Insight","createdAt":"2026-01-01T00:00:00Z"},{"id":"precis","name":"Précis Translator","createdAt":"2026-01-01T00:00:00Z"}]"""
    private val tasks = """[
        {"id":"1","productId":"insight","type":"post","title":"Lancement Insight sur LinkedIn","state":"preparing","priority":1,"dueAt":"2026-11-05T15:00:00Z","assigneeId":"u-me","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
        {"id":"2","productId":"insight","type":"newsletter","title":"Édito de novembre","state":"awaiting_approval","dueAt":"2026-11-12T15:00:00Z","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
        {"id":"3","productId":"precis","type":"article","title":"Atelier Maître — rétrospective","state":"reviewing","dueAt":"2026-11-04T15:00:00Z","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}
    ]"""

    private fun api() = StudioApi(
        "https://api.test",
        InMemoryTokenStore("tok"),
        MockEngine { request ->
            val body = when (request.url.encodedPath) {
                "/me" -> me
                "/products" -> products
                "/tasks" -> tasks
                else -> """{"title":"Not found","status":404}"""
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
    )

    @Test
    fun today_view_lists_overdue_first() {
        val model = AppModel(api(), CoroutineScope(Dispatchers.Unconfined))
        val ctx = ViewContext(Instant.parse("2026-11-05T10:00:00Z"), TimeZone.UTC, "u-me")
        compose.setContent {
            val state by model.state.collectAsState()
            StudioTheme { DayScreen(state, model, ctx) }
        }
        compose.waitUntil(5_000) { model.state.value.tasks.isNotEmpty() && !model.state.value.loading }
        compose.onNodeWithText("Atelier Maître — rétrospective").assertExists()
        compose.onNodeWithText("Lancement Insight sur LinkedIn").assertExists()
        compose.onNodeWithText("Édito de novembre").assertDoesNotExist()
        compose.onRoot().captureRoboImage()
    }
}
