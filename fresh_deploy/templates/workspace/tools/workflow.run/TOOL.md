# workflow.run

Purpose:
- Execute a predefined toolchain workflow from `workspace/workflows/workflows.yaml`.

Input:
- `workflow` (required): workflow id under top-level `workflows:` map.
- `workflow_file` (optional): workflow file under `workspace/workflows` (default `workflows.yaml`).
- `params` (optional): parameter values for workflow params.
- `queue` (optional): default queue for steps that do not override queue.

Workflow YAML shape:
- `workflows` (required object map)
  - `<workflow_id>`
    - `name`, `description` (optional)
    - `params` (optional array)
      - `name` (required), `required` (optional bool), `default` (optional)
    - `steps` (required array)
      - `id` (optional, recommended)
      - `type` (required, existing job type)
      - `input` (optional object)
      - `depends_on` (optional array of previous step ids)
      - `queue`, `priority`, `timeout_sec`, `max_attempts`, `tags` (optional)

Templating:
- `${param_name}`: workflow param value
- `${step_id.field}`: field from dependency step result JSON

Notes:
- Steps are executed dependency-aware and waited to completion before dependent templating.
- Recursive `workflow.run` calls are blocked.
- Keep workflows deterministic and safe for unattended execution.
