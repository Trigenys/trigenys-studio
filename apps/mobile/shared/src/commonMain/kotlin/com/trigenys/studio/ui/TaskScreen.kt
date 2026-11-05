package com.trigenys.studio.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.trigenys.studio.api.TaskDetail
import com.trigenys.studio.api.TaskState
import com.trigenys.studio.domain.REASONED
import com.trigenys.studio.domain.canReview
import com.trigenys.studio.domain.formatDue
import com.trigenys.studio.domain.label
import kotlinx.datetime.TimeZone

@Composable
fun TaskScreen(state: UiState, model: AppModel, zone: TimeZone = TimeZone.currentSystemDefault()) {
    val task = state.task ?: TaskScreenState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = model::back) { Text("← Ma journée") }
        if (task.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        val d = task.detail
        if (d == null) {
            task.error?.let { ErrorRow(it) }
            return@Column
        }
        Header(d, state, zone)
        if (d.brief.isNotBlank()) Section("Brief") { Text(d.brief) }
        Section("Contenu") {
            val v = d.latestVersion
            if (v == null) Muted("Aucune version rédigée.") else {
                Muted("Version ${v.n} · ${v.channel}${if (v.aiAssisted) " · assistée" else ""} · ${formatDue(v.createdAt, zone)}")
                Text(v.body)
            }
            d.latestApproval?.let { a ->
                Muted(
                    "Dernière décision : ${if (a.decision == "approved") "approuvée" else "rejetée"}" +
                        (a.comment?.let { " (« $it »)" } ?: "") +
                        " · " + if (d.approvalValid) "valable pour cette version" else "ne couvre plus cette version",
                )
            }
        }
        Section("Commentaires") { CommentsBlock(task, state, model, zone) }
        Section("Actions") { ActionsBlock(d, task, state, model) }
    }
}

@Composable
private fun Header(d: TaskDetail, state: UiState, zone: TimeZone) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Muted("${d.productId} · ${d.type}")
        Text(d.title, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(d.state.label, color = MaterialTheme.colorScheme.primary)
            Muted(formatDue(d.dueAt, zone)?.let { "Échéance $it" } ?: "Sans échéance")
            Muted("Priorité ${d.priority}")
        }
        if (d.assigneeId != null && d.assigneeId == state.me?.userId) Muted("Assignée à vous")
    }
}

@Composable
private fun CommentsBlock(task: TaskScreenState, state: UiState, model: AppModel, zone: TimeZone) {
    var body by remember { mutableStateOf("") }
    if (task.comments.isEmpty()) Muted("Aucun commentaire.")
    task.comments.forEach { c ->
        Column {
            Muted("${if (c.authorId == state.me?.userId) "Vous" else c.authorId ?: "Système"} · ${formatDue(c.createdAt, zone)}")
            Text(c.body)
        }
    }
    OutlinedTextField(
        value = body,
        onValueChange = { body = it },
        label = { Text("Votre commentaire") },
        enabled = !task.busy,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedButton(onClick = { model.comment(body); body = "" }, enabled = !task.busy && body.isNotBlank()) { Text("Commenter") }
}

@Composable
private fun ActionsBlock(d: TaskDetail, task: TaskScreenState, state: UiState, model: AppModel) {
    val me = state.me
    val reviewable = d.state == TaskState.AWAITING_APPROVAL && me != null && me.canReview(d.productId)
    val isAuthor = d.latestVersion?.authorId != null && d.latestVersion.authorId == me?.userId
    var comment by remember { mutableStateOf("") }
    var pendingTo by remember { mutableStateOf<TaskState?>(null) }
    var reason by remember { mutableStateOf("") }

    task.error?.let { ErrorRow(it) }
    task.notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

    if (reviewable) {
        if (isAuthor) Muted("Vous avez rédigé cette version : la décision revient à une autre personne.")
        OutlinedTextField(
            value = comment,
            onValueChange = { comment = it },
            label = { Text("Commentaire (facultatif)") },
            enabled = !task.busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { model.decide("approved", comment) }, enabled = !task.busy && !isAuthor) { Text("Approuver") }
            Button(
                onClick = { model.decide("rejected", comment) },
                enabled = !task.busy && !isAuthor,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
            ) { Text("Rejeter") }
        }
    }

    if (d.allowedTransitions.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            d.allowedTransitions.forEach { to ->
                OutlinedButton(
                    onClick = {
                        if (to in REASONED && pendingTo != to) pendingTo = to
                        else { model.transition(to, reason); pendingTo = null; reason = "" }
                    },
                    enabled = !task.busy,
                ) { Text("→ ${to.label}") }
            }
            pendingTo?.let { to ->
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Motif pour « ${to.label} » (facultatif)") },
                    enabled = !task.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { model.transition(to, reason); pendingTo = null; reason = "" }, enabled = !task.busy) { Text("Confirmer") }
                    TextButton(onClick = { pendingTo = null }, enabled = !task.busy) { Text("Annuler") }
                }
            }
        }
    } else if (!reviewable) {
        Muted("Aucune action disponible pour votre rôle dans cet état.")
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            HorizontalDivider()
            content()
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
