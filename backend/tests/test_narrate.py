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


def test_narrator_treats_the_off_topic_sentinel_as_nothing_to_say():
    from llm import NarrationLLM

    class FakeCompletions:
        def __init__(self, text): self.text = text
        def create(self, **kw):
            class R: pass
            r = R(); r.choices = [type("C", (), {"message": type("M", (), {"content": self.text})()})()]
            return r

    class FakeClient:
        def __init__(self, text): self.chat = type("Chat", (), {"completions": FakeCompletions(text)})()

    n = NarrationLLM(api_key="x")
    n._client = FakeClient("OFF_TOPIC")
    assert n.narrate("give me a cookie recipe") is None
    n._client = FakeClient("off-topic.")
    assert n.narrate("tell me a joke") is None
    n._client = FakeClient("Opening the Hurricane Lowell report.")
    assert n.narrate("Take me to the Lowell report") == "Opening the Hurricane Lowell report"
