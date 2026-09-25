import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ratelimit import RateLimiter  # noqa: E402


def test_per_minute_and_per_hour_windows():
    t = [1000.0]
    rl = RateLimiter(per_minute=3, per_hour=5, global_per_day=100, clock=lambda: t[0])
    assert [rl.check("a") for _ in range(3)] == ["", "", ""]
    assert rl.check("a") == "ip"              # 4th in the same minute
    assert rl.check("b") == ""                # other clients unaffected
    t[0] += 61
    assert rl.check("a") == ""                # minute window slid
    assert rl.check("a") == ""                # 5th in the hour
    assert rl.check("a") == "ip"              # hourly cap
    t[0] += 3601
    assert rl.check("a") == ""                # hour window slid


def test_global_daily_budget_then_rollover():
    t = [86400.0 * 10 + 5]
    rl = RateLimiter(per_minute=100, per_hour=100, global_per_day=2, clock=lambda: t[0])
    assert rl.check("a") == "" and rl.check("b") == ""
    assert rl.check("c") == "global" and rl.today_count == 2
    t[0] += 86400
    assert rl.check("c") == "" and rl.today_count == 1
