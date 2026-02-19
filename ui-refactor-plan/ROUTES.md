# ROUTES.md

## Global
- /projects
- /logs (global runs list + viewer)

## Project (nested)
- /projects/:projectId → redirect /overview
- /projects/:projectId/overview
- /projects/:projectId/chat
- /projects/:projectId/tasks
- /projects/:projectId/memory
- /projects/:projectId/repo
- /projects/:projectId/workdir
- /projects/:projectId/logs
- /projects/:projectId/settings

Default landing:
- /projects/yleischat/chat
