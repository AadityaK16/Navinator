"""Build the app and mount the routers."""

from fastapi import FastAPI

from .routes import auth, todos


def create_app() -> FastAPI:
    app = FastAPI(title="Todo API")
    app.include_router(auth.router)
    app.include_router(todos.router)
    return app


app = create_app()
