package com.trigenys.studio.domain

import com.trigenys.studio.api.Me
import com.trigenys.studio.api.TaskFields
import com.trigenys.studio.api.TaskState
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

// Same views and ordering as apps/web/src/views.ts, so a task shows up in the
// same list on the phone and on the web.

enum class ViewId(val label: String, val empty: String) {
    TODAY("Aujourd'hui", "Rien à faire aujourd'hui : aucune tâche due ou assignée."),
    REVIEW("À valider", "Aucun contenu n'attend une validation."),
    LATE("En retard", "Aucune tâche en retard."),
}

@OptIn(ExperimentalTime::class)
data class ViewContext(val now: Instant, val zone: TimeZone, val userId: String)

private val DONE = setOf(TaskState.PUBLISHED, TaskState.MEASURED)

val TaskFields.isActive: Boolean get() = state !in DONE

@OptIn(ExperimentalTime::class)
val TaskFields.due: Instant? get() = dueAt?.let { runCatching { Instant.parse(it) }.getOrNull() }

@OptIn(ExperimentalTime::class)
private fun ViewContext.startOfDay(): Instant = now.toLocalDateTime(zone).date.atStartOfDayIn(zone)

@OptIn(ExperimentalTime::class)
private fun ViewContext.endOfDay(): Instant =
    now.toLocalDateTime(zone).date.plus(1, DateTimeUnit.DAY).atStartOfDayIn(zone)

@OptIn(ExperimentalTime::class)
fun TaskFields.isLate(ctx: ViewContext): Boolean {
    val d = due ?: return false
    return isActive && d < ctx.startOfDay()
}

@OptIn(ExperimentalTime::class)
fun TaskFields.matches(view: ViewId, ctx: ViewContext): Boolean = when (view) {
    ViewId.TODAY -> isActive && (due?.let { it < ctx.endOfDay() } ?: (assigneeId == ctx.userId))
    ViewId.REVIEW -> state == TaskState.AWAITING_APPROVAL
    ViewId.LATE -> isLate(ctx)
}

/** Overdue first, then nearest due date, then priority, then title. */
@OptIn(ExperimentalTime::class)
fun <T : TaskFields> sortTasks(tasks: List<T>, ctx: ViewContext): List<T> = tasks.sortedWith(
    compareBy<T> { if (it.isLate(ctx)) 0 else 1 }
        .thenBy { it.due?.toEpochMilliseconds() ?: Long.MAX_VALUE }
        .thenByDescending { it.priority }
        .thenBy { it.title.lowercase() },
)

val STATE_LABELS: Map<TaskState, String> = mapOf(
    TaskState.QUALIFYING to "À qualifier",
    TaskState.PREPARING to "En préparation",
    TaskState.REVIEWING to "En relecture",
    TaskState.VISUALS to "Visuels",
    TaskState.AWAITING_APPROVAL to "À valider",
    TaskState.APPROVED to "Approuvée",
    TaskState.SCHEDULED to "Programmée",
    TaskState.PUBLISHED to "Publiée",
    TaskState.MEASURED to "Mesurée",
    TaskState.NEEDS_FIX to "À corriger",
    TaskState.REJECTED to "Rejetée",
    TaskState.FAILED to "Échec de publication",
)

val TaskState.label: String get() = STATE_LABELS.getValue(this)

/** Sending a task back deserves a reason; the other moves are self-explanatory. */
val REASONED: Set<TaskState> = setOf(TaskState.NEEDS_FIX, TaskState.FAILED)

/** Whether the decision buttons are shown; the server remains the authority (403 otherwise). */
fun Me.canReview(productId: String): Boolean =
    grants.any { (it.role == "admin" || it.role == "reviewer") && (it.productId == null || it.productId == productId) }

/** `dd/MM HH:mm` in the given zone, for list rows and headers. */
@OptIn(ExperimentalTime::class)
fun formatDue(iso: String?, zone: TimeZone): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val t = instant.toLocalDateTime(zone)
    fun two(n: Int) = n.toString().padStart(2, '0')
    return "${two(t.day)}/${two(t.month.ordinal + 1)} ${two(t.hour)}:${two(t.minute)}"
}
