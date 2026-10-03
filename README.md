# RepoNav

RepoNav answers a question about one Python backend by walking only real call and dependency edges. Each stop shows the function source and the file and line of the hop that got you there.

The preloaded repo is [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) at `1762adac607a1b29cfc4da129557780beea71616` (`demo-repo/PIN`). `demo-repo/backend/app/api/deps.py` parenthesizes one `except` clause so Python 3.12 can parse the module. Line numbers are unchanged.

## Questions

- How does login work, and where does the request end up?
- How does an authenticated request load the current user?
- How is a new user created?

With no API key, `/ask` plays the saved tour for that question. Set `ANTHROPIC_API_KEY` and leave `DEMO_MODE` unset to use the live agent. If the agent fails or runs long, the server returns the saved tour.

## Run

From the repo root, with Python 3.11+ and Node 22:

```bash
python3 -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
python3 -m uvicorn reponav.server:app --app-dir backend --host 0.0.0.0 --port 8741
```

In another shell:

```bash
cd frontend && npm run dev
```

The UI is at `http://127.0.0.1:43123`. The API is at `http://127.0.0.1:8741`. Copy `backend/.env.example` to `backend/.env` if you want a key or `DEMO_MODE=cached`.

## Regenerate the graph

```bash
cd backend
python3 -m reponav.parser ../demo-repo/backend data/graph.json
python3 -m pytest
```

`backend/data/layout.json` is a frozen layout. The UI loads it on startup so the graph does not reshuffle. After a parser change, delete `layout.json` once and reload; the view will settle and save a new layout.
