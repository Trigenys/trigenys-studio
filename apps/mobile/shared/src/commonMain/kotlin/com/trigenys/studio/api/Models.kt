package com.trigenys.studio.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Hand-written mirror of packages/contracts/openapi.json for the mobile scope.
// Field names and enum values are the contract; unknown keys are ignored so
// additive server changes never break an installed app.

@Serializable
enum class TaskState {
    @SerialName("qualifying") QUALIFYING,
    @SerialName("preparing") PREPARING,
    @SerialName("reviewing") REVIEWING,
    @SerialName("visuals") VISUALS,
    @SerialName("awaiting_approval") AWAITING_APPROVAL,
    @SerialName("approved") APPROVED,
    @SerialName("scheduled") SCHEDULED,
    @SerialName("published") PUBLISHED,
    @SerialName("measured") MEASURED,
    @SerialName("needs_fix") NEEDS_FIX,
    @SerialName("rejected") REJECTED,
    @SerialName("failed") FAILED,
}

@Serializable
data class RoleGrant(val role: String, val productId: String? = null)

@Serializable
data class Me(val userId: String, val email: String, val name: String, val grants: List<RoleGrant>)

@Serializable
data class Product(val id: String, val name: String, val createdAt: String)

/** What Task and TaskDetail share, so views and sorting work on both. */
interface TaskFields {
    val id: String
    val productId: String
    val type: String
    val title: String
    val brief: String
    val state: TaskState
    val priority: Int
    val dueAt: String?
    val assigneeId: String?
}

@Serializable
data class Task(
    override val id: String,
    override val productId: String,
    override val type: String,
    override val title: String,
    override val brief: String = "",
    override val state: TaskState,
    override val priority: Int = 0,
    override val dueAt: String? = null,
    override val assigneeId: String? = null,
    val version: Int = 1,
    val createdBy: String? = null,
    val createdAt: String,
    val updatedAt: String,
) : TaskFields

@Serializable
data class ContentVersion(
    val id: String,
    val taskId: String,
    val n: Int,
    val channel: String,
    val body: String,
    val contentHash: String,
    val aiAssisted: Boolean = false,
    val authorId: String? = null,
    val createdAt: String,
)

@Serializable
data class Approval(
    val id: String,
    val taskId: String,
    val contentVersionId: String,
    val contentHash: String,
    val assetSetHash: String,
    val approverId: String? = null,
    val decision: String,
    val comment: String? = null,
    val createdAt: String,
)

@Serializable
data class TaskDetail(
    override val id: String,
    override val productId: String,
    override val type: String,
    override val title: String,
    override val brief: String = "",
    override val state: TaskState,
    override val priority: Int = 0,
    override val dueAt: String? = null,
    override val assigneeId: String? = null,
    val version: Int = 1,
    val createdBy: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val latestVersion: ContentVersion? = null,
    val latestApproval: Approval? = null,
    val approvalValid: Boolean = false,
    val allowedTransitions: List<TaskState> = emptyList(),
) : TaskFields

@Serializable
data class Comment(val id: String, val taskId: String, val authorId: String? = null, val body: String, val createdAt: String)

@Serializable
data class TaskTransition(
    val id: String,
    val taskId: String,
    val fromState: TaskState,
    val toState: TaskState,
    val actorId: String? = null,
    val reason: String? = null,
    val createdAt: String,
)

/** RFC 9457 Problem Details, as every API error is returned. */
@Serializable
data class Problem(val type: String? = null, val title: String, val status: Int, val detail: String? = null)

@Serializable
data class DecideApproval(val decision: String, val comment: String? = null)

@Serializable
data class RequestTransition(val to: TaskState, val reason: String? = null)

@Serializable
data class CreateComment(val body: String)

@Serializable
internal data class MagicLinkRequest(val email: String, val callbackURL: String? = null)

@Serializable
internal data class SessionResponse(val token: String? = null)
