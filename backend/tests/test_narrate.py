from fastapi.testclient import TestClient
import app as appmod


class FakeNarrator:
    configured = True
    def __init__(self, line): self.line = line; self.asked = []
    def narrate(self, message): self.asked.append(message); return self.line


def test_narrate_returns_the_models_line(monkeypatch):
    client = TestClient(appmod.app)
    appmod.app.state.narrator = FakeNarrator("Pulling up the API access info")
    r = client.post("/api/narrate", json={"message": "how do I get station data through the API?"})
    assert r.status_code == 200 and r.json() == {"line": "Pulling up the API access info"}
    assert appmod.app.state.narrator.asked == ["how do I get station data through the API?"]


def test_narrate_is_null_when_the_model_fails_or_is_missing():
    client = TestClient(appmod.app)
    appmod.app.state.narrator = FakeNarrator(None)
    assert client.post("/api/narrate", json={"message": "x"}).json() == {"line": None}
    appmod.app.state.narrator = None
    assert client.post("/api/narrate", json={"message": "x"}).json() == {"line": None}
