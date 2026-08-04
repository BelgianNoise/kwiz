# Slice log

One entry per slice, appended by the agent that completed it. See
[`agent-workflow.md`](agent-workflow.md) §6 for the required shape.

The next agent inherits your code and none of your reasoning. This file is the only channel
between them.

Every entry must answer five things: **what you built**, **where you deviated from the specs
and why**, **what you raised without resolving**, **what you deliberately left out**, and
**what the next agent would otherwise have to rediscover**.

---

<!-- Slice 0 appends the first entry below this line. -->
