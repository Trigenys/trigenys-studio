package com.trigenys.studio.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.trigenys.studio.api.Task
import com.trigenys.studio.domain.ViewContext
import com.trigenys.studio.domain.ViewId
import com.trigenys.studio.domain.formatDue
import com.trigenys.studio.domain.isLate
import com.trigenys.studio.domain.label
import com.trigenys.studio.domain.matches
import com.trigenys.studio.domain.sortTasks
import kotlinx.datetime.TimeZone
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

@OptIn(ExperimentalTime::class)
@Composable
fun DayScreen(state: UiState, model: AppModel, ctx: ViewContext = ViewContext(Clock.System.now(), TimeZone.currentSystemDefault(), state.me?.userId ?: "")) {
    val visible = sortTasks(
        state.tasks.filter { (state.productFilter == null || it.productId == state.productFilter) && it.matches(state.view, ctx) },
        ctx,
    )
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("Ma journée", style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = model::signOut) { Text(state.me?.name ?: "Déconnexion") }
        }
        PrimaryTabRow(selectedTabIndex = state.view.ordinal) {
            ViewId.entries.forEach { v ->
                Tab(selected = v == state.view, onClick = { model.selectView(v) }, text = { Text(v.label) })
            }
        }
        if (state.products.size > 1) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(selected = state.productFilter == null, onClick = { model.selectProduct(null) }, label = { Text("Tous") })
                state.products.forEach { p ->
                    FilterChip(selected = state.productFilter == p.id, onClick = { model.selectProduct(p.id) }, label = { Text(p.name) })
                }
            }
        }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { ErrorRow(it, onRetry = model::refresh) }
        if (!state.loading && state.error == null && visible.isEmpty()) {
            Text(state.view.empty, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(visible, key = { it.id }) { t -> TaskRow(t, ctx, onClick = { model.openTask(t.id) }) }
        }
    }
}

@Composable
private fun TaskRow(t: Task, ctx: ViewContext, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${t.productId} · ${t.type}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(t.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(t.state.label, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                val due = formatDue(t.dueAt, ctx.zone)
                Text(
                    if (due == null) "Sans échéance" else if (t.isLate(ctx)) "En retard · $due" else "Échéance $due",
                    color = if (t.isLate(ctx)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
internal fun ErrorRow(message: String, onRetry: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
        if (onRetry != null) TextButton(onClick = onRetry) { Text("Réessayer") }
    }
}
