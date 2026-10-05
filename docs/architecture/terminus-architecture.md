# Terminus Architecture

## Purpose

Define the architectural boundary between Terminus Core, its interfaces, and optional cloud/enterprise services.

## 1. Terminus as a system

Terminus is not the desktop application alone. It is the system composed around a shared Core runtime.

~~~text
                         TERMINUS
                            |
                           CORE
                            |
          +-----------------+------------------+
          |                 |                  |
         CLI               TUI                APP
          |                 |                  |
       commands         terminal UI         desktop UI
                            |
                           MCP
~~~

The Core owns the capabilities and state of the local Terminus runtime. Interfaces translate those capabilities into commands, terminal interaction, graphical interaction, or agent-facing tools.

## 2. Core

Core is the backend/runtime and the primary open-source technology of Terminus.

Core owns:

- agents and agent instances
- sessions
- tasks
- workspaces
- worktrees
- memory and memory providers
- configuration
- persistence
- lifecycle
- execution events
- agent-to-agent relationships
- execution graph
- local runtime state

Rule:

> If a capability must continue to exist when the desktop application is closed, it belongs in Core.

Core exposes programmatic operations rather than UI-specific behavior.

Examples:

~~~text
create_session()
create_task()
spawn_agent()
stop_agent()
send_message()
memory.save()
memory.recall()
workspace.list()
worktree.create()
events.subscribe()
graph.get_execution()
~~~

## 3. Agent definitions

Agent definitions are separate from agent executions.

The existing agent-creator project provides the declarative contract for defining agents in repositories:

https://github.com/danil-labs/agent-creator

Conceptually:

~~~text
AgentDefinition
      |
      v
AgentInstance
      |
      v
Session
      |
      v
Task / Execution
~~~

The repository definition answers "what is this agent?". Core manages "what is this instance doing right now?".

Agent definitions remain repository/project artifacts. Runtime instances and lifecycle state belong to Core.

## 4. CLI

The CLI is an open-source interface to Core.

Examples:

~~~text
terminus session create
terminus task create
terminus agent spawn
terminus memory recall
terminus workspace list
terminus events
~~~

The CLI should not become the hidden backend.

Preferred dependency:

~~~text
CLI -> Core
~~~

not:

~~~text
App -> CLI -> Core
TUI -> CLI -> Core
~~~

The CLI may contain command parsing, formatting, completion and terminal concerns, but domain behavior belongs to Core.

## 5. TUI

The TUI is another interface to Core.

~~~text
Core
 |
 +-- CLI
 +-- TUI
 +-- App
 +-- MCP
~~~

The TUI can reuse libraries from the CLI, but it should not conceptually depend on the CLI as its backend.

## 6. Terminus App

The desktop application is primarily a visual interface over Core.

It may contain substantial UI-specific functionality:

- navigation
- visualization
- panels
- layout
- onboarding
- keyboard/mouse interaction
- graph visualization
- execution inspection

It should not duplicate Core business logic.

The App can inspect Core's filesystem representation, but mutations and domain operations should preferably go through Core APIs.

## 7. MCP / agent interface

MCP exposes Core capabilities to agents.

~~~text
Agent
  |
 MCP
  |
 Core
~~~

Examples:

~~~text
list_workspaces
create_session
create_task
spawn_agent
get_task
send_message
get_execution_graph
~~~

MCP is another interface to Core, not the owner of the underlying runtime.

## 8. Agent execution graph

The execution graph represents runtime relationships between executions, not declarative agent definitions.

Example:

~~~text
              Architect
                  |
               spawned
                  v
               Backend
              /       \
          spawned    spawned
            v           v
         Tester      Reviewer
~~~

Useful node types:

- AgentInstance
- Session
- Task
- Execution

Useful edge types:

- spawned_by
- delegated_to
- depends_on
- communicates_with
- reports_to

The graph is dynamic and event-driven.

## 9. Events are the source of runtime truth

Agent lifecycle produces Core events:

~~~text
AgentSpawned
SessionCreated
TaskCreated
TaskStarted
AgentMessageSent
TaskCompleted
AgentCompleted
AgentFailed
SessionClosed
~~~

When an agent invokes another agent through the CLI:

~~~text
CLI command
    |
    v
Core.spawn_agent()
    |
    +--> create execution
    +--> emit AgentSpawned
    +--> update graph
    |
    +--> App/TUI observe event
~~~

The CLI should not manually update the graph and the App should not infer the graph from UI state.

## 10. Graph persistence

Do not make the graph itself the primary source of truth.

Prefer:

~~~text
Core events
    |
    v
Execution state
    |
    v
Graph projection
~~~

For an initial implementation, an event log plus execution records and a derived graph can be sufficient. A database is not mandatory for V1.

Possible local runtime layout:

~~~text
~/.terminus/
  workspaces/
  sessions/
  tasks/
  agents/
  memory/
  runtime/
    events/
    executions/
    graph/
~~~

The exact persistence mechanism is an implementation decision. The invariant is that the graph is reconstructable from runtime state/events.

## 11. Reasoning and messages

The execution graph should not store all agent reasoning.

The graph describes relationships and lifecycle.

Reasoning, messages, logs and artifacts should be separate records linked through IDs:

~~~text
execution_id
task_id
session_id
agent_instance_id
~~~

This allows the App to display:

~~~text
Agent
  -> Execution
      -> Task
      -> Events
      -> Messages
      -> Reasoning
      -> Worktree
~~~

without turning the graph into a storage model for everything.

## 12. Memory

Memory is a Core capability.

Core should define a memory abstraction rather than hard-code one provider.

~~~text
Memory
  |
  +-- local memory
  +-- custom provider
  +-- future external provider
~~~

Agent definitions may determine memory behavior/configuration, but Core owns the runtime contract.

## 13. Local open-source boundary vs cloud services

The local Terminus runtime should remain useful without a cloud account.

Open-source local layer:

- Core
- CLI
- TUI
- Desktop App
- MCP
- local memory
- local execution graph
- local lifecycle/events
- local workspaces/worktrees

Potential private/commercial cloud layer:

- shared memory across users/agents
- cloud-persistent agent state
- cross-machine synchronization
- organization-wide agent communication
- messages between agents belonging to different users
- hosted execution
- centralized governance
- audit/observability
- enterprise permissions
- hosted connectors/services

These services should not force the local Core to become closed.

Preferred boundary:

~~~text
Open Source Terminus
        |
        | optional adapter / client
        v
Terminus Cloud
~~~

The cloud service can be proprietary while the local Core remains open source.

## 14. Architectural principle

> Core defines what Terminus can do. Interfaces define how humans and agents access it.

Therefore:

~~~text
             WHAT
              |
             CORE
              |
      +-------+-------+
      |       |       |
     HOW     HOW     HOW
     CLI     TUI     APP
                     |
                    HOW
                    MCP
~~~

Interfaces should remain replaceable. Core should not depend on the existence of the desktop application.

## 15. Initial repository strategy

The architecture can be represented as separate packages even if implementation starts in one repository.

Possible monorepo:

~~~text
terminus/
  core/
  cli/
  tui/
  app/
  mcp/
  docs/
~~~

Do not split into physical repositories solely for conceptual purity. Split repositories when independent versioning, ownership, release cadence or distribution makes it useful.

The conceptual boundaries should exist before the physical repository boundaries.
