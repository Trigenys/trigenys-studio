package com.trigenys.studio.domain

import com.trigenys.studio.api.Me
import com.trigenys.studio.api.RoleGrant
import com.trigenys.studio.api.Task
import com.trigenys.studio.api.TaskState
import kotlinx.datetime.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

@OptIn(ExperimentalTime::class)
class ViewsTest {
    private val ctx = ViewContext(Instant.parse("2026-11-05T10:00:00Z"), TimeZone.UTC, "u-me")

    private fun task(
        id: String,
        state: TaskState = TaskState.PREPARING,
        dueAt: String? = null,
        assigneeId: String? = null,
        priority: Int = 0,
        title: String = id,
    ) = Task(
        id = id, productId = "insight", type = "post", title = title, state = state, priority = priority,
        dueAt = dueAt, assigneeId = assigneeId, createdAt = "2026-01-01T00:00:00Z", updatedAt = "2026-01-01T00:00:00Z",
    )

    @Test
    fun today_holds_tasks_due_today_or_assigned_without_due_date() {
        assertTrue(task("a", dueAt = "2026-11-05T15:00:00Z").matches(ViewId.TODAY, ctx))
        assertTrue(task("b", dueAt = "2026-11-04T15:00:00Z").matches(ViewId.TODAY, ctx), "overdue is still today")
        assertFalse(task("c", dueAt = "2026-11-06T00:00:00Z").matches(ViewId.TODAY, ctx), "tomorrow is not today")
        assertTrue(task("d", assigneeId = "u-me").matches(ViewId.TODAY, ctx))
        assertFalse(task("e", assigneeId = "u-other").matches(ViewId.TODAY, ctx))
        assertFalse(task("f", state = TaskState.PUBLISHED, dueAt = "2026-11-05T15:00:00Z").matches(ViewId.TODAY, ctx), "done tasks drop out")
    }

    @Test
    fun late_means_due_before_start_of_day_and_still_active() {
        assertTrue(task("a", dueAt = "2026-11-04T23:59:00Z").isLate(ctx))
        assertFalse(task("b", dueAt = "2026-11-05T00:00:00Z").isLate(ctx))
        assertFalse(task("c", state = TaskState.MEASURED, dueAt = "2026-11-01T00:00:00Z").isLate(ctx))
        assertTrue(task("d", dueAt = "2026-11-01T00:00:00Z").matches(ViewId.LATE, ctx))
    }

    @Test
    fun review_is_awaiting_approval_only() {
        assertTrue(task("a", state = TaskState.AWAITING_APPROVAL).matches(ViewId.REVIEW, ctx))
        assertFalse(task("b", state = TaskState.APPROVED).matches(ViewId.REVIEW, ctx))
    }

    @Test
    fun sort_puts_late_first_then_due_then_priority_then_title() {
        val sorted = sortTasks(
            listOf(
                task("z", title = "Zèbre", priority = 3),
                task("a", title = "Antilope", priority = 3),
                task("soon", dueAt = "2026-11-05T18:00:00Z"),
                task("late", dueAt = "2026-11-01T00:00:00Z"),
                task("prio", priority = 1),
            ),
            ctx,
        ).map { it.id }
        assertEquals(listOf("late", "soon", "a", "z", "prio"), sorted)
    }

    @Test
    fun can_review_honours_global_and_product_grants() {
        val reviewerEverywhere = Me("u", "e", "n", listOf(RoleGrant("reviewer", null)))
        val operatorOnInsight = Me("u", "e", "n", listOf(RoleGrant("operator", "insight")))
        val adminOnPrecis = Me("u", "e", "n", listOf(RoleGrant("admin", "precis")))
        assertTrue(reviewerEverywhere.canReview("insight"))
        assertFalse(operatorOnInsight.canReview("insight"))
        assertTrue(adminOnPrecis.canReview("precis"))
        assertFalse(adminOnPrecis.canReview("insight"))
    }

    @Test
    fun labels_and_dates_render_in_french() {
        assertEquals("À valider", TaskState.AWAITING_APPROVAL.label)
        assertEquals("05/11 15:30", formatDue("2026-11-05T15:30:00Z", TimeZone.UTC))
        assertEquals(null, formatDue(null, TimeZone.UTC))
        assertEquals(null, formatDue("not-a-date", TimeZone.UTC))
    }
}
