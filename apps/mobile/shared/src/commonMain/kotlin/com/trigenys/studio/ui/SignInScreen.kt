package com.trigenys.studio.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
fun SignInScreen(signIn: SignInState, model: AppModel) {
    var pasted by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Trigenys Studio", style = MaterialTheme.typography.headlineMedium)
        Text("Connexion par lien magique.", color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (!signIn.sent) {
            OutlinedTextField(
                value = signIn.email,
                onValueChange = model::setEmail,
                label = { Text("Adresse e-mail") },
                singleLine = true,
                enabled = !signIn.busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = model::requestLink, enabled = !signIn.busy && signIn.email.isNotBlank()) {
                Text("Recevoir le lien")
            }
        } else {
            Text("Lien envoyé à ${signIn.email}. Ouvrez-le sur ce téléphone, ou collez-le ci-dessous.")
            OutlinedTextField(
                value = pasted,
                onValueChange = { pasted = it },
                label = { Text("Lien ou jeton") },
                enabled = !signIn.busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { model.openLink(pasted) }, enabled = !signIn.busy && pasted.isNotBlank()) {
                Text("Se connecter")
            }
            TextButton(onClick = { model.setEmail(signIn.email); model.signOut() }, enabled = !signIn.busy) {
                Text("Changer d'adresse")
            }
        }

        signIn.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { contentDescription = "Erreur" })
        }
    }
}
