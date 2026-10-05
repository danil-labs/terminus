# Terminus Cloud Boundary

## Status

Proposed.

## Decision

Terminus must have a clean boundary between the local open-source runtime and optional hosted services.

The local Core must not require Terminus Cloud to execute agents, manage sessions, maintain local memory, or operate the local execution graph.

Cloud functionality should be implemented as optional services and adapters.

## Local Core

The local runtime owns:

- execution
- sessions
- tasks
- agents
- workspaces
- worktrees
- local memory
- local events
- local execution graph
- local agent-to-agent communication
- configuration
- local persistence

## Cloud services

Cloud may provide capabilities that require shared infrastructure, identity, multi-user coordination, or persistent hosted state.

Examples:

- shared organizational memory
- cross-machine memory synchronization
- cross-user agent communication
- hosted agent messaging
- centralized execution history
- organization-wide governance
- RBAC and policy enforcement
- audit logs
- hosted connectors
- remote execution
- team/project coordination
- enterprise administration

These are services, not replacements for the local Core.

## Installation model

The local Terminus distribution should contain the Core runtime and interfaces required by the user.

A cloud-enabled installation may additionally install or activate a cloud adapter/client.

Conceptually:

~~~text
                Terminus installation
                       |
                +------+------+
                |             |
              Core       Cloud Adapter
                |             |
          local runtime   Terminus Cloud
~~~

The Cloud Adapter should be replaceable and communicate through explicit Core interfaces.

## Privacy boundary

Private cloud capabilities should not require putting the complete local runtime behind a proprietary binary.

Prefer:

~~~text
Open Source Core
      |
      +---- optional Cloud Adapter
                    |
                    v
              Private Cloud
~~~

rather than making the Core itself closed.

The exact packaging and licensing strategy is a later product decision.

## Agent communication

Local communication:

~~~text
Agent A -> Terminus Core -> Agent B
~~~

Cloud communication:

~~~text
User/Agent A
     |
     v
Cloud Adapter
     |
     v
Terminus Cloud
     |
     v
User/Agent B
~~~

The Core should expose a communication abstraction so local and remote transports share a conceptual API.

Examples:

~~~text
send_message(target, message)
subscribe_messages(scope)
~~~

The transport and authorization layer can differ between local and cloud execution.

## Shared memory

Memory should follow the same abstraction.

~~~text
MemoryProvider
   |
   +-- LocalMemoryProvider
   +-- CloudMemoryProvider
   +-- ExternalMemoryProvider
~~~

The Core should not assume that memory is local forever, but the default local implementation should work without cloud infrastructure.

## Security

Cloud services must define their own authentication, authorization, tenancy, encryption, retention and audit boundaries.

The local Core should never implicitly upload workspace contents, prompts, messages, memory or execution data merely because a cloud adapter is installed.

Data synchronization must be explicit and policy-controlled.

## Product principle

The open-source local runtime should be a complete product.

Cloud should add capabilities that become valuable when multiple users, machines, organizations or remote agents need to coordinate.

This keeps the architecture modular:

~~~text
TERMINUS LOCAL
    Core
    CLI
    TUI
    App
    MCP
    Local Memory
    Local Graph

             +

TERMINUS CLOUD
    Shared State
    Collaboration
    Governance
    Remote Execution
    Enterprise Services
~~~
