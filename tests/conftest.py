"""pytest 共享夹具：桩化 Strava 客户端与本地缓存，绝不触网、不写真实缓存。"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402

CACHE_VERSION = app_module.CACHE_VERSION


def make_activity(idx, sport="Ride", sport_type="Ride", day=1, month=10, year=2026, **overrides):
    """构造一条结构完整的假活动记录。"""
    activity = {
        "id": 900000 + idx,
        "name": f"测试活动 {idx}",
        "type": sport,
        "sport_type": sport_type,
        "start_date": f"{year}-{month:02d}-{day:02d}T01:00:00+00:00",
        "start_date_local": f"{year}-{month:02d}-{day:02d}T09:00:00",
        "distance": 20000.0 + idx * 1000,
        "moving_time": 3600 + idx * 60,
        "elapsed_time": 3700 + idx * 60,
        "total_elevation_gain": 100.0 + idx,
        "average_speed": 6.5,
        "max_speed": 12.0,
        "average_cadence": 82.0,
        "average_heartrate": 140.0,
        "max_heartrate": 168.0,
        "suffer_score": 50.0 + idx,
        "has_heartrate": True,
        "average_watts": 180.0,
        "weighted_average_watts": 200.0,
        "max_watts": 600.0,
        "kilojoules": 700.0,
    }
    activity.update(overrides)
    return activity


def make_route(activity_id, point_count=10, with_points=True):
    """构造 /map/routes 返回结构里的单条轨迹。"""
    points = []
    if with_points:
        points = [[30.0 + i * 0.001, 120.0 + i * 0.001] for i in range(point_count)]
    return {
        "id": activity_id,
        "name": f"轨迹 {activity_id}",
        "sport_type": "Ride",
        "start_date_local": "2026-10-01T09:00:00",
        "distance_km": 25.0,
        "points": points,
    }


class FakeState(dict):
    """替代 app.session_state 的极简字典。"""

    @classmethod
    def anonymous(cls):
        return cls(client=None, access_token=None, athlete_id=None)


class RouteStubs:
    """轨迹相关桩的容器。"""

    def __init__(self, monkeypatch):
        self._monkeypatch = monkeypatch
        self.routes = {}
        self.streams = {}
        monkeypatch.setattr(app_module, "_cached_route_ids", lambda: set(self.routes.keys()))
        monkeypatch.setattr(app_module, "load_route_cache", lambda aid: self.routes.get(aid))
        monkeypatch.setattr(
            app_module, "save_route_cache", lambda aid, data: self.routes.__setitem__(aid, data)
        )
        monkeypatch.setattr(app_module, "load_streams_cache", lambda aid: self.streams.get(aid))

    def set_fetch(self, fn):
        self._monkeypatch.setattr(app_module, "_fetch_route_streams", fn)


@pytest.fixture
def fake_activities():
    return [
        make_activity(1, day=5),
        make_activity(2, sport="Run", sport_type="Run", day=6),
        make_activity(3, day=20, month=9),  # 9 月，用于验证年月筛选
    ]


@pytest.fixture
def fake_cache(fake_activities):
    return {
        "version": CACHE_VERSION,
        "athlete_id": "tester",
        "last_sync_time": "2026-11-06T08:00:00+00:00",
        "last_full_sync_time": "2026-11-01T08:00:00+00:00",
        "activities": fake_activities,
    }


@pytest.fixture
def api(monkeypatch, fake_cache, authorized=True):
    """返回已配置好桩的 Flask 测试客户端。"""

    def install(state):
        monkeypatch.setattr(app_module, "load_cache", lambda: fake_cache)
        monkeypatch.setattr(
            app_module, "sync_activities", lambda force_full=False: fake_cache["activities"]
        )
        monkeypatch.setattr(app_module, "_ensure_athlete_identity", lambda: "tester")
        monkeypatch.setattr(app_module, "get_cached_athlete", lambda: {"id": 1, "firstname": "T"})
        monkeypatch.setattr(app_module, "get_cached_zones", lambda: [])
        monkeypatch.setattr(app_module, "session_state", state)

    install(
        FakeState(client=object(), access_token="token", athlete_id="tester")
        if authorized
        else FakeState()
    )
    return app_module.app.test_client()


@pytest.fixture
def anonymous_api(monkeypatch, fake_cache):
    """未授权状态：缓存桩照常可用，但 client 为空。"""
    monkeypatch.setattr(app_module, "load_cache", lambda: fake_cache)
    monkeypatch.setattr(app_module, "session_state", FakeState.anonymous())
    return app_module.app.test_client()


@pytest.fixture
def route_stubs(monkeypatch):
    """轨迹相关桩：全部走内存，避免读写 cache/ 目录。"""
    return RouteStubs(monkeypatch)
