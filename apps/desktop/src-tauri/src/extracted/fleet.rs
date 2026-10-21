//! Varias máquinas en un mismo workspace. Un workspace y sus proyectos de la cuenta
//! tienen el mismo id en cada máquina; los de antes, ids propios que la ventana enlaza.
//! Las tareas son de su máquina: la ventana recuerda en cuál vive cada una.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
use terminus_engine_client::Client;
use terminus_engine_protocol::Error;

/// Un motor al que se le manda `service invoke`; contesta el sobre `{"value"}` o `{"error"}`.
pub(super) trait Engine {
    fn call(
        &self,
        command: &str,
        workspace: Option<String>,
        arguments: Value,
    ) -> Result<Value, Error>;
}
impl Engine for Client {
    fn call(
        &self,
        command: &str,
        workspace: Option<String>,
        arguments: Value,
    ) -> Result<Value, Error> {
        self.invoke(command, workspace, arguments)
    }
}

fn value(
    engine: &dyn Engine,
    command: &str,
    workspace: Option<String>,
    args: Value,
) -> Option<Value> {
    engine
        .call(command, workspace, args)
        .ok()?
        .get("value")
        .cloned()
}

/// La tarea que nombra una orden según sus parámetros congelados: `session`, o
/// `id` junto a `project` (`load_session`, `rename_session`, `finish_task`…).
pub(super) fn named_session<'a>(spec: &Value, args: &'a Value) -> Option<&'a str> {
    let keys: Vec<&str> = spec["parameters"]
        .as_array()?
        .iter()
        .filter_map(|p| p["key"].as_str())
        .collect();
    if keys.contains(&"session") {
        if let Some(session) = args["session"].as_str() {
            return Some(session);
        }
    }
    if keys.contains(&"project") && keys.contains(&"id") {
        return args["id"].as_str();
    }
    None
}

/// Los eventos que se reenvían desde otra máquina: los de una tarea. Los de cuentas,
/// agentes o atención hablan de esa máquina entera y no de este workspace.
const TASK_EVENTS: &[&str] = &["chat", "session", "question"];

#[derive(Default, Serialize, Deserialize)]
struct Memory {
    /// Por máquina: workspace de la ventana → el suyo.
    #[serde(default)]
    workspaces: BTreeMap<String, BTreeMap<String, String>>,
    /// Por máquina: `<workspace>/<proyecto>` de la ventana → proyecto suyo.
    #[serde(default)]
    projects: BTreeMap<String, BTreeMap<String, String>>,
    /// Por máquina: lo último que listó, por `<workspace>/<proyecto>` de la ventana.
    #[serde(default)]
    known: BTreeMap<String, BTreeMap<String, Vec<Value>>>,
}

// La copia de lo último que se leyó de cada tarea remota, para enseñarla con su máquina
// apagada: como mucho tantas tareas, y ninguna más grande que esto.
const CACHED_TASKS: usize = 40;
const CACHED_TASK_BYTES: usize = 2 * 1024 * 1024;

pub(super) struct Fleet {
    file: Option<PathBuf>,
    tasks: Option<PathBuf>,
    memory: Mutex<Memory>,
    /// `(workspace de la ventana, tarea)` → máquina. La de la ventana no se apunta.
    owners: Mutex<BTreeMap<(String, String), String>>,
}

fn key(workspace: &str, project: &str) -> String {
    format!("{workspace}/{project}")
}

impl Fleet {
    /// Lo que recuerda la ventana en `window_data`: enlaces y listas en `machines.json`,
    /// transcripciones en `machine-tasks/`.
    pub fn load(window_data: Option<&Path>) -> Self {
        let file = window_data.map(|d| d.join("machines.json"));
        let tasks = window_data.map(|d| d.join("machine-tasks"));
        let memory: Memory = file
            .as_ref()
            .and_then(|f| std::fs::read(f).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let mut owners = BTreeMap::new();
        for (machine, lists) in &memory.known {
            for (place, rows) in lists {
                let workspace = place.split('/').next().unwrap_or_default();
                for id in rows.iter().filter_map(|r| r["id"].as_str()) {
                    owners.insert((workspace.to_owned(), id.to_owned()), machine.clone());
                }
            }
        }
        Self {
            file,
            tasks,
            memory: Mutex::new(memory),
            owners: Mutex::new(owners),
        }
    }
    fn memory(&self) -> MutexGuard<'_, Memory> {
        self.memory.lock().unwrap_or_else(|p| p.into_inner())
    }
    fn save(&self, memory: &Memory) {
        let Some(file) = &self.file else { return };
        let Ok(bytes) = serde_json::to_vec(memory) else {
            return;
        };
        let partial = file.with_extension("json.partial");
        if std::fs::write(&partial, bytes).is_ok() {
            let _ = std::fs::rename(&partial, file);
        }
    }

    pub fn owner(&self, workspace: Option<&str>, session: &str) -> Option<String> {
        self.owners
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&(workspace?.to_owned(), session.to_owned()))
            .cloned()
    }
    pub fn adopt(&self, workspace: &str, session: &str, machine: &str) {
        self.owners
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(
                (workspace.to_owned(), session.to_owned()),
                machine.to_owned(),
            );
    }
    /// Si la máquina ya tiene enlazado este workspace, sin preguntarle nada.
    pub fn linked(&self, machine: &str, workspace: &str) -> bool {
        self.memory()
            .workspaces
            .get(machine)
            .is_some_and(|m| m.contains_key(workspace))
    }

    /// El workspace de `there` que es `local` en la ventana: el mismo id (el de la cuenta,
    /// igual en cada máquina), si no el enlazado en `machines.json`, si no el único con el
    /// mismo `git_host` y `remote`. Un nombre igual no basta.
    pub fn counterpart_workspace(
        &self,
        machine: &str,
        local: &str,
        home: &dyn Engine,
        there: &dyn Engine,
    ) -> Option<String> {
        let saved = self
            .memory()
            .workspaces
            .get(machine)
            .and_then(|m| m.get(local))
            .cloned();
        if saved.as_deref() == Some(local) {
            return saved;
        }
        // Un enlace viejo a otro id cede ante el mismo id; con la máquina sin contestar, vale.
        let Some(theirs) = value(there, "list_workspaces", None, json!({})) else {
            return saved;
        };
        let theirs = theirs["workspaces"].as_array()?;
        if theirs.iter().any(|w| w["id"] == local) {
            return Some(self.remember_workspace(machine, local, local));
        }
        if saved.is_some() {
            return saved;
        }
        let mine = value(home, "list_workspaces", None, json!({}))?;
        let mine = mine["workspaces"]
            .as_array()?
            .iter()
            .find(|w| w["id"] == local)?
            .clone();
        let same_remote = |w: &&Value| {
            mine["git_host"].as_str().is_some_and(|p| !p.is_empty())
                && mine["remote"].as_str().is_some_and(|r| !r.is_empty())
                && w["git_host"] == mine["git_host"]
                && w["remote"] == mine["remote"]
        };
        let found = unique(theirs.iter().filter(same_remote))?["id"].as_str()?;
        Some(self.remember_workspace(machine, local, found))
    }

    /// Apunta en `machines.json` qué workspace de `machine` es `local`, para no volver a
    /// preguntar y para traducir sus eventos.
    fn remember_workspace(&self, machine: &str, local: &str, found: &str) -> String {
        let mut memory = self.memory();
        memory
            .workspaces
            .entry(machine.to_owned())
            .or_default()
            .insert(local.to_owned(), found.to_owned());
        self.save(&memory);
        found.to_owned()
    }

    /// El proyecto de `there` que es `project` en la ventana: el mismo id, si no el único
    /// con el mismo nombre; el vacío es «sin proyecto».
    fn project_on(
        &self,
        machine: &str,
        (local, remote): (&str, &str),
        project: &str,
        home: &dyn Engine,
        there: &dyn Engine,
    ) -> Option<String> {
        if project.is_empty() {
            return Some(String::new());
        }
        let place = key(local, project);
        if let Some(found) = self
            .memory()
            .projects
            .get(machine)
            .and_then(|m| m.get(&place))
        {
            return Some(found.clone());
        }
        let theirs = value(there, "list_projects", Some(remote.to_owned()), json!({}))?;
        let theirs = theirs.as_array()?;
        let found = if theirs.iter().any(|p| p["id"] == project) {
            project.to_owned()
        } else {
            let mine = value(home, "list_projects", Some(local.to_owned()), json!({}))?;
            let name = mine
                .as_array()?
                .iter()
                .find(|p| p["id"] == project)?
                .get("name")?
                .clone();
            unique(theirs.iter().filter(|p| p["name"] == name))?["id"]
                .as_str()?
                .to_owned()
        };
        let mut memory = self.memory();
        memory
            .projects
            .entry(machine.to_owned())
            .or_default()
            .insert(place, found.clone());
        self.save(&memory);
        Some(found)
    }

    /// La orden como la entiende la otra máquina: su workspace en el sobre y sus ids de
    /// workspace y proyecto en los argumentos. `None` si esa máquina no tiene este workspace.
    pub fn translate(
        &self,
        machine: &str,
        local: &str,
        args: &Value,
        home: &dyn Engine,
        there: &dyn Engine,
    ) -> Option<(String, Value)> {
        let remote = self.counterpart_workspace(machine, local, home, there)?;
        let mut args = args.clone();
        if let Some(project) = args["project"].as_str().map(str::to_owned) {
            args["project"] =
                json!(self.project_on(machine, (local, &remote), &project, home, there)?);
        }
        if args["workspace"] == local {
            args["workspace"] = json!(remote);
        }
        Some((remote, args))
    }

    /// La lista de la ventana con las tareas de las demás máquinas, cada una con su
    /// `machine`. Una máquina que no contestó aporta lo último que listó, con `machine_on: false`.
    pub fn merge(
        &self,
        local: &str,
        project: &str,
        rows: Value,
        others: Vec<(String, Option<Value>)>,
    ) -> Value {
        let place = key(local, project);
        let mut merged: Vec<Value> = rows.as_array().cloned().unwrap_or_default();
        let mut memory = self.memory();
        let mut changed = false;
        for (machine, fetched) in others {
            let on = fetched.is_some();
            let theirs = match fetched.and_then(|v| v.as_array().cloned()) {
                Some(theirs) => {
                    let known = memory.known.entry(machine.clone()).or_default();
                    if known.get(&place) != Some(&theirs) {
                        known.insert(place.clone(), theirs.clone());
                        changed = true;
                    }
                    theirs
                }
                None => memory
                    .known
                    .get(&machine)
                    .and_then(|k| k.get(&place))
                    .cloned()
                    .unwrap_or_default(),
            };
            let mut owners = self.owners.lock().unwrap_or_else(|p| p.into_inner());
            let tagged = theirs.into_iter().map(|mut row| {
                if let Some(id) = row["id"].as_str() {
                    owners.insert((local.to_owned(), id.to_owned()), machine.clone());
                }
                row["machine"] = json!(machine);
                row["machine_on"] = json!(on);
                row
            });
            merged = newest_first(merged, tagged.collect());
        }
        if changed {
            self.save(&memory);
        }
        Value::Array(merged)
    }

    /// Un evento de otra máquina con los ids de la ventana, o `None` si no es de una
    /// tarea de un workspace enlazado.
    pub fn localize(&self, machine: &str, name: &str, payload: &Value) -> Option<Value> {
        if !TASK_EVENTS.contains(&name) {
            return None;
        }
        let memory = self.memory();
        let remote = payload["workspace"].as_str()?;
        let local = memory
            .workspaces
            .get(machine)?
            .iter()
            .find(|(_, theirs)| theirs.as_str() == remote)?
            .0
            .clone();
        let mut payload = payload.clone();
        payload["workspace"] = json!(local);
        if let Some(project) = payload["project"].as_str().map(str::to_owned) {
            let prefix = key(&local, "");
            let mapped = memory.projects.get(machine).and_then(|m| {
                m.iter()
                    .find(|(place, theirs)| place.starts_with(&prefix) && **theirs == project)
                    .map(|(place, _)| place[prefix.len()..].to_owned())
            });
            if let Some(mapped) = mapped.or_else(|| project.is_empty().then(String::new)) {
                payload["project"] = json!(mapped);
            }
        }
        drop(memory);
        if let Some(session) = payload["session"].as_str() {
            self.adopt(&local, session, machine);
        }
        Some(payload)
    }
}

impl Fleet {
    /// La máquina a la que va una orden: la elegida para crear la tarea, o la dueña de la
    /// tarea que nombra. `None` es la de la ventana.
    pub fn target(
        &self,
        spec: &Value,
        args: &Value,
        workspace: Option<&str>,
        chosen: Option<&str>,
    ) -> Option<String> {
        chosen
            .map(str::to_owned)
            .or_else(|| named_session(spec, args).and_then(|s| self.owner(workspace, s)))
    }

    /// Manda la orden a otra máquina con sus ids; la tarea que crea queda apuntada a ella.
    /// `None` si esa máquina no tiene este workspace.
    pub fn forward(
        &self,
        machine: &str,
        local: &str,
        spec: &Value,
        args: &Value,
        home: &dyn Engine,
        there: &dyn Engine,
    ) -> Option<Result<Value, Error>> {
        let name = spec["name"].as_str()?;
        let (workspace, translated) = self.translate(machine, local, args, home, there)?;
        let sent = there.call(name, Some(workspace), translated);
        if named_session(spec, args).is_none() {
            let created = sent.as_ref().ok().map(|v| &v["value"]);
            if let Some(created) = created.and_then(|v| v.as_str().or(v["session"].as_str())) {
                self.adopt(local, created, machine);
            }
        }
        Some(sent)
    }

    /// Una acción de la persona sobre una tarea de otra máquina. Si no contesta, `wake` la
    /// enciende y la orden sale una vez, ya con el motor contestando: `app_unavailable`
    /// y no poder traducirla son no haberla mandado.
    #[allow(clippy::too_many_arguments)]
    pub fn deliver<E: Engine>(
        &self,
        machine: &str,
        local: &str,
        spec: &Value,
        args: &Value,
        home: &dyn Engine,
        there: Option<Arc<E>>,
        wake: impl FnOnce() -> Result<Arc<E>, Error>,
    ) -> Result<Option<Result<Value, Error>>, Error> {
        if let Some(there) = there {
            match self.forward(machine, local, spec, args, home, &*there) {
                Some(Err(e)) if e.code == "app_unavailable" => {}
                None => {}
                sent => return Ok(sent),
            }
        }
        let there = wake()?;
        Ok(self.forward(machine, local, spec, args, home, &*there))
    }

    fn task_file(&self, machine: &str, session: &str) -> Option<PathBuf> {
        let plain = |s: &str| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        };
        (plain(machine) && plain(session))
            .then(|| {
                self.tasks
                    .as_ref()
                    .map(|d| d.join(format!("{machine}--{session}.json")))
            })
            .flatten()
    }
    /// Guarda lo que se acaba de leer de una tarea remota; se borran las más viejas.
    pub fn remember_task(&self, machine: &str, session: &str, transcript: &Value) {
        let (Some(file), Some(dir)) = (self.task_file(machine, session), &self.tasks) else {
            return;
        };
        let Ok(bytes) = serde_json::to_vec(transcript) else {
            return;
        };
        if bytes.len() > CACHED_TASK_BYTES {
            let _ = std::fs::remove_file(&file);
            return;
        }
        let partial = file.with_extension("partial");
        if std::fs::create_dir_all(dir).is_err() || std::fs::write(&partial, bytes).is_err() {
            return;
        }
        let _ = std::fs::rename(&partial, &file);
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut saved: Vec<_> = entries
            .flatten()
            .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
            .filter(|(_, path)| path.extension().is_some_and(|x| x == "json"))
            .collect();
        saved.sort_by_key(|entry| std::cmp::Reverse(entry.0));
        for (_, old) in saved.into_iter().skip(CACHED_TASKS) {
            let _ = std::fs::remove_file(old);
        }
    }
    /// Una tarea de una máquina apagada: lo último que se leyó de ella, o solo su fila,
    /// con `offline` para que la ventana lo diga y no la trate como un fallo.
    pub fn offline_task(&self, machine: &str, local: &str, session: &str) -> Value {
        let cached = self
            .task_file(machine, session)
            .and_then(|f| std::fs::read(f).ok())
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        let mut task = cached.unwrap_or_else(|| {
            let memory = self.memory();
            let prefix = key(local, "");
            let row = memory
                .known
                .get(machine)
                .into_iter()
                .flat_map(|lists| lists.iter())
                .filter(|(place, _)| place.starts_with(&prefix))
                .flat_map(|(_, rows)| rows.iter())
                .find(|row| row["id"] == session)
                .cloned()
                .unwrap_or_default();
            json!({
                "id": session, "provider": row["provider"].as_str().unwrap_or_default(),
                "model": row["model"], "effort": null, "turns": [],
                "history": {"total":0,"start":0,"end":0,"limit":0,"has_more":false},
            })
        });
        task["offline"] = json!({ "machine": machine });
        task
    }

    /// `list_live_sessions` de la ventana más el de cada otra máquina; `None` es una
    /// máquina que no contesta sin encenderla.
    pub fn list(
        &self,
        local: &str,
        args: &Value,
        rows: Value,
        home: &dyn Engine,
        others: &[(String, Option<&dyn Engine>)],
    ) -> Value {
        let fetched = others
            .iter()
            .map(|(machine, there)| {
                let theirs = there.and_then(|there| {
                    let (workspace, args) = self.translate(machine, local, args, home, there)?;
                    value(there, "list_live_sessions", Some(workspace), args)
                });
                (machine.clone(), theirs)
            })
            .collect();
        self.merge(
            local,
            args["project"].as_str().unwrap_or_default(),
            rows,
            fetched,
        )
    }

    /// `list_active_turns` o `list_live_turns` más los turnos vivos de las demás máquinas.
    pub fn turns(
        &self,
        command: &str,
        local: &str,
        args: &Value,
        mine: Value,
        home: &dyn Engine,
        others: &[(String, Option<&dyn Engine>)],
    ) -> Value {
        let mut all = mine.as_array().cloned().unwrap_or_default();
        for (machine, there) in others {
            let Some(there) = there else { continue };
            let Some((remote, translated)) = self.translate(machine, local, args, home, *there)
            else {
                continue;
            };
            let theirs = value(*there, command, Some(remote.clone()), translated);
            for mut turn in theirs
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
            {
                let ours = turn["workspace"] == remote.as_str();
                if ours {
                    turn["workspace"] = json!(local);
                }
                if let Some(session) = turn
                    .as_str()
                    .or(ours.then(|| turn["session"].as_str()).flatten())
                {
                    self.adopt(local, session, machine);
                }
                all.push(turn);
            }
        }
        Value::Array(all)
    }
}

fn unique<'a>(mut found: impl Iterator<Item = &'a Value>) -> Option<&'a Value> {
    let first = found.next()?;
    found.next().is_none().then_some(first)
}

/// `list_live_sessions` ordena por nacimiento, la más nueva delante; se intercalan sin
/// reordenar ninguna de las dos.
fn newest_first(a: Vec<Value>, b: Vec<Value>) -> Vec<Value> {
    let born = |row: &Value| row["created_at"].as_f64().unwrap_or(0.0);
    let mut out = Vec::with_capacity(a.len() + b.len());
    let (mut a, mut b) = (a.into_iter().peekable(), b.into_iter().peekable());
    loop {
        let take_a = match (a.peek(), b.peek()) {
            (Some(x), Some(y)) => born(x) >= born(y),
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => return out,
        };
        out.extend(if take_a { a.next() } else { b.next() });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// Un motor de laboratorio con sus propios ids: contesta lo suyo y apunta lo que recibe.
    /// Apagado, no contesta nada y la orden no le llega.
    #[derive(Default)]
    struct Fake {
        workspaces: Value,
        projects: Value,
        sessions: Value,
        created: &'static str,
        off: bool,
        seen: RefCell<Vec<(String, Option<String>, Value)>>,
    }
    impl Engine for Fake {
        fn call(
            &self,
            command: &str,
            workspace: Option<String>,
            args: Value,
        ) -> Result<Value, Error> {
            if self.off {
                return Err(Error::new("app_unavailable"));
            }
            self.seen
                .borrow_mut()
                .push((command.to_owned(), workspace, args.clone()));
            let value = match command {
                "list_workspaces" => self.workspaces.clone(),
                "list_projects" => self.projects.clone(),
                "list_live_sessions" => self.sessions.clone(),
                "send_message" if args["session"].is_null() => json!(self.created),
                _ => json!({ "ok": command }),
            };
            Ok(json!({ "value": value }))
        }
    }
    impl Fake {
        fn sent(&self, command: &str) -> Vec<(Option<String>, Value)> {
            self.seen
                .borrow()
                .iter()
                .filter(|(c, _, _)| c == command)
                .map(|(_, w, a)| (w.clone(), a.clone()))
                .collect()
        }
    }
    fn mac() -> Fake {
        Fake {
            workspaces: json!({"workspaces":[{"id":"wmac","name":"Danil","git_host":"github","remote":"danil-labs"},{"id":"wsolo","name":"Notas"}],"active":"wmac"}),
            projects: json!([{"id":"pmac","name":"terminus"}]),
            sessions: json!([{"id":"t1","created_at":30},{"id":"t2","created_at":10}]),
            created: "t9",
            ..Fake::default()
        }
    }
    fn vm() -> Fake {
        Fake {
            workspaces: json!({"workspaces":[{"id":"other","name":"Danil"},{"id":"notas","name":"Notas"},{"id":"wvm","name":"Danil copia","git_host":"github","remote":"danil-labs"}],"active":"wvm"}),
            projects: json!([{"id":"pvm","name":"terminus"}]),
            sessions: json!([{"id":"r1","created_at":20,"provider":"codex","model":"gpt-5.6"}]),
            created: "r2",
            ..Fake::default()
        }
    }
    fn spec(name: &str) -> Value {
        let manifest: Value =
            serde_json::from_str(terminus_engine_protocol::MANIFEST).expect("manifest");
        manifest["commands"]
            .as_array()
            .and_then(|c| c.iter().find(|c| c["name"] == name))
            .cloned()
            .expect("command")
    }

    #[test]
    fn two_engines_one_workspace() {
        let (mac, vm) = (mac(), vm());
        let fleet = Fleet::load(None);
        let others: [(String, Option<&dyn Engine>); 1] = [("vm".into(), Some(&vm))];

        // La lista de la ventana junta las dos máquinas y marca la de cada tarea.
        let args = json!({"project":"pmac","open":[]});
        let mine = value(
            &mac,
            "list_live_sessions",
            Some("wmac".into()),
            args.clone(),
        );
        let merged = fleet.list("wmac", &args, mine.expect("rows"), &mac, &others);
        let ids: Vec<_> = merged
            .as_array()
            .expect("rows")
            .iter()
            .map(|r| (r["id"].clone(), r["machine"].clone()))
            .collect();
        assert_eq!(
            ids,
            vec![
                (json!("t1"), Value::Null),
                (json!("r1"), json!("vm")),
                (json!("t2"), Value::Null)
            ]
        );
        assert_eq!(
            vm.sent("list_live_sessions"),
            vec![(Some("wvm".into()), json!({"project":"pvm","open":[]}))]
        );

        // Una orden sobre la tarea remota va a su motor, con sus ids; una local, no.
        let stop = spec("stop_turn");
        let args = json!({"project":"pmac","session":"r1"});
        let machine = fleet.target(&stop, &args, Some("wmac"), None);
        assert_eq!(machine.as_deref(), Some("vm"));
        fleet
            .forward("vm", "wmac", &stop, &args, &mac, &vm)
            .expect("linked")
            .expect("sent");
        assert_eq!(
            vm.sent("stop_turn"),
            vec![(Some("wvm".into()), json!({"project":"pvm","session":"r1"}))]
        );
        let rename = json!({"project":"pmac","id":"t1","title":"x"});
        assert_eq!(
            fleet.target(&spec("rename_session"), &rename, Some("wmac"), None),
            None
        );

        // Crear en la máquina elegida, sin cambiar el workspace de la ventana.
        let send = spec("send_message");
        let args = json!({"project":"pmac","session":null,"prompt":"hola"});
        let machine = fleet.target(&send, &args, Some("wmac"), Some("vm"));
        assert_eq!(machine.as_deref(), Some("vm"));
        let created = fleet
            .forward("vm", "wmac", &send, &args, &mac, &vm)
            .expect("linked")
            .expect("sent");
        assert_eq!(created["value"], "r2");
        let load = json!({"project":"pmac","id":"r2"});
        assert_eq!(
            fleet
                .target(&spec("load_session"), &load, Some("wmac"), None)
                .as_deref(),
            Some("vm")
        );
        assert!(mac.sent("send_message").is_empty());
    }

    #[test]
    fn the_same_ids_are_the_same_workspace_and_project() {
        let mac = mac();
        // La VM ya tiene el workspace y el proyecto de la cuenta, con sus ids; también una
        // copia vieja con el mismo remoto, que ya no gana.
        let vm = Fake {
            workspaces: json!({"workspaces":[{"id":"wvm","name":"Danil","git_host":"github","remote":"danil-labs"},{"id":"wmac","name":"Danil"}],"active":"wvm"}),
            projects: json!([{"id":"pvm","name":"terminus"},{"id":"pmac","name":"terminus"}]),
            created: "r2",
            ..Fake::default()
        };
        let fleet = Fleet::load(None);
        let send = spec("send_message");
        let args = json!({"project":"pmac","session":null,"prompt":"hola"});
        assert_eq!(
            fleet
                .target(&send, &args, Some("wmac"), Some("vm"))
                .as_deref(),
            Some("vm")
        );
        let created = fleet
            .forward("vm", "wmac", &send, &args, &mac, &vm)
            .expect("linked")
            .expect("sent");
        assert_eq!(created["value"], "r2");
        assert_eq!(
            vm.sent("send_message"),
            vec![(Some("wmac".into()), args.clone())],
            "la VM recibe los mismos ids"
        );
        assert!(mac.sent("send_message").is_empty());
        assert!(fleet.linked("vm", "wmac"));
        // Sus eventos llegan con el mismo id.
        let event = fleet
            .localize(
                "vm",
                "session",
                &json!({"workspace":"wmac","project":"pmac","session":"r2"}),
            )
            .expect("task event");
        assert_eq!(event["workspace"], "wmac");
        assert_eq!(event["project"], "pmac");
    }

    #[test]
    fn a_name_alone_does_not_link_a_saved_link_does() {
        let (mac, vm) = (mac(), vm());
        let dir = tempfile::tempdir().expect("dir");
        // «Notas» se llama igual en las dos y no tiene proveedor: no se enlaza sola.
        let fleet = Fleet::load(Some(dir.path()));
        assert_eq!(fleet.counterpart_workspace("vm", "wsolo", &mac, &vm), None);
        assert!(!fleet.linked("vm", "wsolo"));
        // Un enlace guardado en `machines.json` sí vale, sin preguntarle a nadie.
        std::fs::write(
            dir.path().join("machines.json"),
            json!({"workspaces":{"vm":{"wsolo":"notas"}}}).to_string(),
        )
        .expect("write");
        let fleet = Fleet::load(Some(dir.path()));
        let off = Fake {
            off: true,
            ..Fake::default()
        };
        assert_eq!(
            fleet
                .counterpart_workspace("vm", "wsolo", &mac, &off)
                .as_deref(),
            Some("notas")
        );
    }

    #[test]
    fn asleep_machine_keeps_its_tasks_and_events_come_home() {
        let dir = tempfile::tempdir().expect("dir");
        let (mac, vm) = (mac(), vm());
        let args = json!({"project":"pmac"});
        Fleet::load(Some(dir.path())).list(
            "wmac",
            &args,
            json!([]),
            &mac,
            &[("vm".into(), Some(&vm as &dyn Engine))],
        );
        // Otra sesión de la ventana, con la VM apagada: la tarea sigue listada y enrutada.
        let fleet = Fleet::load(Some(dir.path()));
        let merged = fleet.list("wmac", &args, json!([]), &mac, &[("vm".into(), None)]);
        assert_eq!(
            (&merged[0]["id"], &merged[0]["machine_on"]),
            (&json!("r1"), &json!(false))
        );
        assert_eq!(fleet.owner(Some("wmac"), "r1").as_deref(), Some("vm"));

        let event = fleet
            .localize(
                "vm",
                "session",
                &json!({"workspace":"wvm","project":"pvm","session":"r5"}),
            )
            .expect("task event");
        assert_eq!(
            event,
            json!({"workspace":"wmac","project":"pmac","session":"r5"})
        );
        assert_eq!(fleet.owner(Some("wmac"), "r5").as_deref(), Some("vm"));
        assert!(fleet
            .localize("vm", "account", &json!({"workspace":"wvm"}))
            .is_none());
        assert!(fleet
            .localize("vm", "chat", &json!({"workspace":"other","session":"x"}))
            .is_none());
    }

    #[test]
    fn an_asleep_task_opens_from_its_last_copy() {
        let dir = tempfile::tempdir().expect("dir");
        let (mac, vm) = (mac(), vm());
        let fleet = Fleet::load(Some(dir.path()));
        fleet.list(
            "wmac",
            &json!({"project":"pmac"}),
            json!([]),
            &mac,
            &[("vm".into(), Some(&vm as &dyn Engine))],
        );
        // Nunca leída: solo su fila, sin turnos, y dice qué máquina falta.
        let task = fleet.offline_task("vm", "wmac", "r1");
        assert_eq!(
            (&task["provider"], &task["turns"], &task["offline"]),
            (&json!("codex"), &json!([]), &json!({"machine":"vm"}))
        );
        // Leída antes: lo que se leyó, aunque la ventana se haya cerrado entretanto.
        let read = json!({"id":"r1","provider":"codex","turns":[{"role":"user","text":"hola"}]});
        fleet.remember_task("vm", "r1", &read);
        let task = Fleet::load(Some(dir.path())).offline_task("vm", "wmac", "r1");
        assert_eq!(task["turns"], read["turns"]);
        assert_eq!(task["offline"]["machine"], "vm");
        // Acotada: las más viejas se van, y una transcripción enorme no se guarda.
        for n in 0..CACHED_TASKS + 5 {
            fleet.remember_task("vm", &format!("x{n}"), &read);
        }
        let saved = std::fs::read_dir(dir.path().join("machine-tasks"))
            .expect("dir")
            .count();
        assert_eq!(saved, CACHED_TASKS);
        let huge = json!({"turns":[{"text":"x".repeat(CACHED_TASK_BYTES)}]});
        fleet.remember_task("vm", "big", &huge);
        assert_eq!(fleet.offline_task("vm", "wmac", "big")["turns"], json!([]));
        assert!(fleet.task_file("vm", "../fuera").is_none());
    }

    #[test]
    fn acting_on_an_asleep_task_wakes_it_and_sends_once() {
        let mac = mac();
        let fleet = Fleet::load(None);
        let send = spec("send_message");
        let args = json!({"project":"pmac","session":"r1","prompt":"sigue"});
        // El motor que la ventana tenía de la VM ya no contesta: se enciende y sale una vez.
        let asleep = Arc::new(Fake { off: true, ..vm() });
        let awake = Arc::new(vm());
        let woken = Cell::new(0);
        let sent = fleet
            .deliver("vm", "wmac", &send, &args, &mac, Some(asleep), || {
                woken.set(woken.get() + 1);
                Ok(awake.clone())
            })
            .expect("woken")
            .expect("linked")
            .expect("sent");
        assert_eq!(sent["value"]["ok"], "send_message");
        assert_eq!(woken.get(), 1);
        assert_eq!(
            awake.sent("send_message"),
            vec![(
                Some("wvm".into()),
                json!({"project":"pvm","session":"r1","prompt":"sigue"})
            )]
        );
        // Encendida, no se vuelve a encender; si no enciende, no sale nada.
        fleet
            .deliver(
                "vm",
                "wmac",
                &send,
                &args,
                &mac,
                Some(awake.clone()),
                || {
                    woken.set(woken.get() + 1);
                    Ok(awake.clone())
                },
            )
            .expect("sent");
        assert_eq!((woken.get(), awake.sent("send_message").len()), (1, 2));
        let failed = fleet.deliver::<Fake>("vm", "wmac", &send, &args, &mac, None, || {
            Err(Error::new("app_unavailable"))
        });
        assert!(failed.is_err());
        assert_eq!(awake.sent("send_message").len(), 2);
    }
}
