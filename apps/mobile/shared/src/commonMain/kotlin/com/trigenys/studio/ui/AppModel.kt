package com.trigenys.studio.ui

import com.trigenys.studio.api.ApiException
import com.trigenys.studio.api.Comment
import com.trigenys.studio.api.Me
import com.trigenys.studio.api.Product
import com.trigenys.studio.api.StudioApi
import com.trigenys.studio.api.Task
import com.trigenys.studio.api.TaskDetail
import com.trigenys.studio.api.TaskState
import com.trigenys.studio.auth.MagicLink
import com.trigenys.studio.domain.ViewId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Which screen is on top. The stack is explicit: no navigation library needed for three screens. */
sealed interface Screen {
    data object SignIn : Screen
    data object Day : Screen
    data class Task(val id: String) : Screen
}

/** Everything the UI renders. Errors are the Problem Details the server returned, shown as-is. */
data class UiState(
    val screen: Screen = Screen.SignIn,
    val booting: Boolean = true,
    val me: Me? = null,
    val products: List<Product> = emptyList(),
    val tasks: List<Task> = emptyList(),
    val view: ViewId = ViewId.TODAY,
    val productFilter: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val signIn: SignInState = SignInState(),
    val task: TaskScreenState? = null,
)

data class SignInState(val email: String = "", val sent: Boolean = false, val busy: Boolean = false, val error: String? = null)

data class TaskScreenState(
    val detail: TaskDetail? = null,
    val comments: List<Comment> = emptyList(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

class AppModel(
    private val api: StudioApi,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        if (api.signedIn) scope.launch { enter() } else _state.update { it.copy(booting = false) }
    }

    // --- sign-in ---

    fun setEmail(value: String) = _state.update { it.copy(signIn = it.signIn.copy(email = value, error = null)) }

    fun requestLink() {
        val email = _state.value.signIn.email.trim()
        if (email.isEmpty()) return
        scope.launch {
            _state.update { it.copy(signIn = it.signIn.copy(busy = true, error = null)) }
            runCatching { api.requestMagicLink(email) }
                .onSuccess { _state.update { it.copy(signIn = it.signIn.copy(busy = false, sent = true)) } }
                .onFailure { e -> _state.update { it.copy(signIn = it.signIn.copy(busy = false, error = e.describe())) } }
        }
    }

    /** Called with the opened App Link, or with what the user pasted. */
    fun openLink(input: String) {
        val token = MagicLink.tokenFrom(input)
        if (token == null) {
            _state.update { it.copy(signIn = it.signIn.copy(error = "Ce lien ne contient pas de jeton de connexion.")) }
            return
        }
        scope.launch {
            _state.update { it.copy(signIn = it.signIn.copy(busy = true, error = null)) }
            runCatching { api.verifyMagicLink(token) }
                .onSuccess { enter() }
                .onFailure { e -> _state.update { it.copy(signIn = it.signIn.copy(busy = false, error = e.describe())) } }
        }
    }

    fun signOut() {
        scope.launch {
            api.signOut()
            _state.value = UiState(booting = false)
        }
    }

    private suspend fun enter() {
        runCatching { api.me() }
            .onSuccess { me ->
                _state.update { it.copy(booting = false, me = me, screen = Screen.Day, signIn = SignInState()) }
                refresh()
            }
            .onFailure { e ->
                if (e is ApiException && e.status == 401) api.signOut()
                _state.update {
                    it.copy(booting = false, screen = Screen.SignIn, signIn = it.signIn.copy(busy = false, error = e.describe()))
                }
            }
    }

    // --- day ---

    fun selectView(view: ViewId) = _state.update { it.copy(view = view) }
    fun selectProduct(id: String?) = _state.update { it.copy(productFilter = id) }

    fun refresh() {
        scope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching { api.products() to api.tasks() }
                .onSuccess { (products, tasks) -> _state.update { it.copy(loading = false, products = products, tasks = tasks) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.describe()) } }
        }
    }

    // --- task ---

    fun openTask(id: String) {
        _state.update { it.copy(screen = Screen.Task(id), task = TaskScreenState()) }
        loadTask(id)
    }

    fun back() {
        _state.update { it.copy(screen = Screen.Day, task = null) }
        refresh()
    }

    private fun loadTask(id: String) {
        scope.launch {
            runCatching { api.task(id) to api.comments(id) }
                .onSuccess { (d, c) -> updateTask { it.copy(detail = d, comments = c, loading = false, error = null) } }
                .onFailure { e -> updateTask { it.copy(loading = false, error = e.describe()) } }
        }
    }

    fun decide(decision: String, comment: String?) = act("Décision enregistrée.") { id ->
        api.decide(id, decision, comment?.takeIf { it.isNotBlank() })
    }

    fun transition(to: TaskState, reason: String?) = act("État mis à jour.") { id ->
        api.transition(id, to, reason?.takeIf { it.isNotBlank() })
    }

    fun comment(body: String) {
        val id = currentTaskId() ?: return
        if (body.isBlank()) return
        scope.launch {
            updateTask { it.copy(busy = true, error = null, notice = null) }
            runCatching { api.addComment(id, body.trim()) }
                .onSuccess { c -> updateTask { it.copy(busy = false, comments = it.comments + c) } }
                .onFailure { e -> updateTask { it.copy(busy = false, error = e.describe()) } }
        }
    }

    private fun act(notice: String, call: suspend (String) -> TaskDetail) {
        val id = currentTaskId() ?: return
        scope.launch {
            updateTask { it.copy(busy = true, error = null, notice = null) }
            runCatching { call(id) }
                .onSuccess { d -> updateTask { it.copy(busy = false, detail = d, notice = notice) } }
                .onFailure { e -> updateTask { it.copy(busy = false, error = e.describe()) } }
        }
    }

    private fun currentTaskId(): String? = (_state.value.screen as? Screen.Task)?.id

    private fun updateTask(f: (TaskScreenState) -> TaskScreenState) =
        _state.update { s -> s.copy(task = f(s.task ?: TaskScreenState())) }
}

internal fun Throwable.describe(): String = when (this) {
    is ApiException -> detail?.let { "$title : $it" } ?: title
    else -> message ?: "Erreur réseau."
}
