# Navinator

Navinator answers a question about one Python backend by walking only real call and dependency edges. Each stop shows the function source and the file and line of the hop that got you there.

The preloaded repo is [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) at `1762adac607a1b29cfc4da129557780beea71616` (`demo-repo/PIN`). `demo-repo/backend/app/api/deps.py` parenthesizes one `except` clause so Python 3.12 can parse the module. Line numbers are unchanged.

## Questions

- How does login work, and where does the request end up?
- How does an authenticated request load the current user?
- How is a new user created?

With no API key, `/ask` plays the saved tour for that question. Set `ANTHROPIC_API_KEY` and leave `DEMO_MODE` unset to use the live agent. If the agent fails or runs long, the server returns the saved tour.

## Run

From the repo root, with Python 3.11+ (ideally 3.12) and Node 22:

```bash
python3 -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
python3 -m uvicorn navinator.server:app --app-dir backend --host 0.0.0.0 --port 8741
```

In another shell:

```bash
cd frontend && npm run dev
```

The UI is at `http://127.0.0.1:43123`. The API is at `http://127.0.0.1:8741`. Copy `backend/.env.example` to `backend/.env` if you want a key or `DEMO_MODE=cached`.

## Your own repo

The picker at the top of the panel switches between the demo, the projects in `sample-repos/`, and folders you upload. Click "Upload folder" or drop a folder anywhere on the page. Only its `.py` files are sent, and the graph is rebuilt from them. Uploads are saved in `backend/data/uploads/` and stay in the picker; re-uploading a folder with the same name replaces it.

Saved tours and the time machine cover only the demo. To ask questions about another repo, set `ANTHROPIC_API_KEY` or use private mode. Search, regrouping, and the graph work without a key. The first time a repo opens, the graph settles for a few seconds, then its layout is saved in `backend/data/layouts/`.

## Private mode (local LLM)

Run the agent on a model on your own machine so no source code leaves it. Any server that speaks the OpenAI chat API with tool calling works: Ollama, LM Studio, llama.cpp server.

```bash
ollama pull llama3.1:8b        # or qwen2.5:7b, which is stronger at tool calls
LLM_PROVIDER=ollama LOCAL_MODEL=llama3.1:8b python3 -m uvicorn navinator.server:app --app-dir backend --port 8741
```

The UI shows a green "Private mode" badge when the model URL is localhost. Tours from the local model go through the same validator as the cloud model, so a weak model can never show a path that does not exist in the graph. If it fails or runs past two minutes, the saved tour plays instead.

## Grok narration, voice, and regrouping

Add `XAI_API_KEY` to `backend/.env` (optional: `XAI_MODEL`, default `grok-4`; `XAI_VOICE`, default `ara`). With a key:

- Grok rewrites each tour stop's narration from the actual code, then reads it aloud. Pick the voice in the tour bar.
- The Regroup tab asks Grok to reorganise the graph ("group by responsibility", "only the password code"). Every grouping stays in the list, including the original, so you can switch back.

Without a key, tours use the saved narration and the browser voice, and Regroup keeps the code that matches your words. If a Grok call fails, the same fallbacks kick in and the UI says why.

Tour controls: Back, Pause, Next, Exit tour, or ← → Space Esc. Up (or Esc) walks out one level: function, file, folder or group, everything. Home jumps to the full view.

## Time machine

`backend/data/history.json` replays every commit that touched the backend (2019 to the pin) through the same parser. The slider shows when each function, class, and file arrived. To rebuild it:

```bash
git clone https://github.com/fastapi/full-stack-fastapi-template /tmp/fft
cd backend && python3 -m navinator.history /tmp/fft $(head -1 ../demo-repo/PIN) data/history.json
```

## Regenerate the graph

```bash
cd backend
python3 -m navinator.parser ../demo-repo/backend data/graph.json
python3 -m pytest
```

`backend/data/layout.json` is a frozen 3D layout made by `python3 -m navinator.layout3d` (run from `backend`): folders spread around a large sphere, files on a sphere inside their folder, symbols orbiting their file. Click a labelled file node, a folder chip, or "Open its file group" to fly into a group; Esc goes back out. The UI loads it on startup so the graph does not reshuffle. After a parser change, delete `layout.json` once and reload; the view will settle and save a new layout.
