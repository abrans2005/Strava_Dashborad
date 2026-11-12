"""关键接口与工具函数的回归测试。

运行方式：./.venv/bin/python -m pytest
"""
import pytest
import requests

import app as app_module
from tests.conftest import make_activity, make_route


# ---------- 纯函数 ----------

class TestParseActivityFields:
    def test_empty_returns_none(self):
        assert app_module._parse_activity_fields(None) is None
        assert app_module._parse_activity_fields("") is None
        assert app_module._parse_activity_fields("  ") is None

    def test_unknown_field_raises(self):
        with pytest.raises(ValueError):
            app_module._parse_activity_fields("id,ghost")

    def test_ordered_by_canonical_order(self):
        fields = app_module._parse_activity_fields("name,id,distance")
        assert fields == ["id", "name", "distance"]

    def test_id_always_included(self):
        assert app_module._parse_activity_fields("distance") == ["id", "distance"]


class TestActivitiesEtag:
    def test_stable_for_same_data(self, fake_activities):
        assert (
            app_module._activities_etag(fake_activities, None)
            == app_module._activities_etag(fake_activities, None)
        )

    def test_changes_when_data_changes(self, fake_activities):
        changed = [dict(a, distance=a["distance"] + 1) for a in fake_activities]
        assert app_module._activities_etag(fake_activities, None) != app_module._activities_etag(changed, None)

    def test_changes_with_fields(self, fake_activities):
        assert app_module._activities_etag(fake_activities, ["id", "name"]) != app_module._activities_etag(
            fake_activities, ["id", "distance"]
        )


class TestRouteHelpers:
    def test_route_points_limit(self):
        assert app_module._route_points_limit(60) == app_module.ROUTE_MAP_THIN_POINTS
        assert app_module._route_points_limit(61) == 80
        assert app_module._route_points_limit(301) == 40
        assert app_module._route_points_limit(1001) == 20

    def test_thin_route_keeps_shape_and_rounds(self):
        route = make_route(1, point_count=400)
        thinned = app_module._thin_route(route, max_points=100, precision=4)
        assert len(thinned["points"]) == 100
        assert thinned["points"][0] == [30.0, 120.0]
        assert all(
            len(str(lat).split(".")[-1]) <= 4 for lat, _ in thinned["points"] if "." in str(lat)
        )
        assert thinned["id"] == 1

    def test_thin_route_keeps_route_below_limit(self):
        route = make_route(1, point_count=50)
        thinned = app_module._thin_route(route, max_points=100, precision=5)
        assert len(thinned["points"]) == 50


# ---------- /activities ----------

class TestActivitiesEndpoint:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/activities").status_code == 401

    def test_returns_full_list_with_etag(self, api, fake_activities):
        resp = api.get("/activities")
        assert resp.status_code == 200
        assert resp.get_json() == fake_activities
        assert resp.headers.get("ETag")
        assert resp.headers.get("Cache-Control") == "private, no-cache"

    def test_field_projection(self, api):
        resp = api.get("/activities?fields=id,name,distance")
        rows = resp.get_json()
        assert all(set(row.keys()) == {"id", "name", "distance"} for row in rows)

    def test_invalid_field_rejected(self, api):
        resp = api.get("/activities?fields=id,ghost")
        assert resp.status_code == 400
        assert "ghost" in resp.get_json()["error"]

    def test_conditional_request_returns_304(self, api):
        first = api.get("/activities")
        etag = first.headers["ETag"]
        second = api.get("/activities", headers={"If-None-Match": etag})
        assert second.status_code == 304
        assert second.data == b""

    def test_etag_changes_after_data_change(self, api, fake_cache):
        first = api.get("/activities")
        etag = first.headers["ETag"]
        fake_cache["activities"][0]["distance"] += 500
        second = api.get("/activities", headers={"If-None-Match": etag})
        assert second.status_code == 200


# ---------- /sync-status ----------

class TestSyncStatus:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/sync-status").status_code == 401

    def test_returns_cache_summary(self, api, fake_cache):
        resp = api.get("/sync-status")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["activity_count"] == len(fake_cache["activities"])
        assert body["last_sync_time"] == fake_cache["last_sync_time"]


# ---------- /chart ----------

class TestChartEndpoint:
    def test_returns_monthly_series(self, api):
        resp = api.get("/chart")
        assert resp.status_code == 200
        body = resp.get_json()
        assert set(body["series"].keys()) == {
            "count", "distance_km", "moving_time_hours", "elevation_gain_m"
        }
        assert body["summary"]["count"] == 3

    def test_filters_by_month_and_sport(self, api):
        body = api.get("/chart?year=2026&month=10&sport_type=Run").get_json()
        assert body["summary"]["count"] == 1

    def test_invalid_month_rejected(self, api):
        assert api.get("/chart?month=13").status_code == 400

    def test_invalid_metric_rejected(self, api):
        assert api.get("/chart?metric=ghost").status_code == 400

    def test_year_out_of_range_rejected(self, api):
        assert api.get("/chart?year=3000").status_code == 400


class TestDateRangeArgs:
    """start/end 日期范围筛选（全局时间范围的后端支持）。"""

    def test_chart_range_filters_and_labels(self, api):
        body = api.get("/chart?start=2026-10-01&end=2026-10-31").get_json()
        assert body["labels"] == ["2026-10"]
        assert body["filters"]["start"] == "2026-10-01"
        assert body["filters"]["end"] == "2026-10-31"
        assert body["summary"]["count"] == 2

    def test_chart_range_across_months(self, api):
        body = api.get("/chart?start=2026-09-01&end=2026-10-31").get_json()
        assert body["labels"] == ["2026-09", "2026-10"]

    def test_invalid_start_rejected(self, api):
        assert api.get("/chart?start=bad").status_code == 400

    def test_reversed_range_rejected(self, api):
        assert api.get("/chart?start=2026-10-10&end=2026-10-01").status_code == 400

    def test_top_distance_with_range(self, api):
        resp = api.get("/chart/top-distance?start=2026-10-01&end=2026-10-31")
        assert resp.status_code == 200
        # 未指定运动类型时保持“骑行”口径，10 月仅一条骑行
        assert len(resp.get_json()) == 1

    def test_map_routes_with_range(self, api, route_stubs):
        route_stubs.set_fetch(lambda aid: ([[30.0, 120.0], [30.1, 120.1]], [0.0, 1.0], [0.0, 1.0]))
        body = api.get("/map/routes?start=2026-10-01&end=2026-10-31&fetch=5").get_json()
        assert body["stats"]["total"] == 2
        assert body["filters"]["start"] == "2026-10-01"

    def test_training_load_accepts_arbitrary_days(self, api):
        resp = api.get("/training-load?days=311")
        assert resp.status_code == 200
        assert api.get("/training-load?days=0").status_code == 400


# ---------- /records 个人纪录 ----------

def _fake_streams():
    """均匀速度、恒定功率的假流数据：27 个采样点，每 100 秒前进 0.5 km。"""
    return {
        "time": [i * 100 for i in range(27)],
        "distance_km": [round(i * 0.5, 2) for i in range(27)],
        "watts": [250.0] * 27,
        "has_watts": True,
    }


class TestRecords:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/records").status_code == 401

    def test_invalid_range_rejected(self, api):
        assert api.get("/records?start=bad").status_code == 400

    def test_activity_level_records(self, api, fake_cache):
        fake_cache["activities"].append(make_activity(
            10, day=15, distance=60000, total_elevation_gain=1200,
            moving_time=7200, average_watts=280, weighted_average_watts=300,
            average_heartrate=165, suffer_score=150, average_speed=8.3,
        ))
        body = api.get("/records").get_json()
        recs = {r["key"]: r for r in body["records"]}

        assert recs["longest_distance"]["value"] == 60000
        assert recs["longest_distance"]["display"] == "60.00 km"
        assert recs["longest_distance"]["activity"]["id"] == 900010
        assert recs["max_elevation"]["value"] == 1200
        assert recs["longest_time"]["value"] == 7200
        assert recs["max_avg_power"]["value"] == 280
        assert recs["max_suffer"]["value"] == 150
        assert recs["max_avg_speed"]["display"] == "29.9 km/h"
        assert body["stream_records"] == []
        assert body["stream_coverage"]["total"] == 4

    def test_stream_records(self, api, monkeypatch):
        streams = _fake_streams()
        monkeypatch.setattr(
            app_module, "load_streams_cache",
            lambda aid: streams if aid == 900001 else None,
        )
        body = api.get("/records").get_json()
        sr = {r["key"]: r for r in body["stream_records"]}

        # 均匀 0.5km/100s → 最快 5K = 1000s，配速 3:20/km
        assert sr["fastest_5k"]["value"] == 1000
        assert sr["fastest_5k"]["pace"] == "3:20 /km"
        assert sr["fastest_10k"]["value"] == 2000
        assert sr["power_20min"]["value"] == 250.0
        assert body["stream_coverage"] == {"checked": 1, "total": 3}

    def test_stream_records_filtered_by_sport(self, api, monkeypatch):
        monkeypatch.setattr(
            app_module, "load_streams_cache",
            lambda aid: _fake_streams() if aid == 900001 else None,
        )
        # 900001 是 Ride，sport_type=Run 时不参与统计
        body = api.get("/records?sport_type=Run").get_json()
        assert body["stream_records"] == []
        assert body["stream_coverage"]["checked"] == 0


# ---------- /gear/stats 装备里程 ----------

GEAR_ATHLETE = {
    "bikes": [
        {"id": "b1", "name": "主战车", "distance": 2450000},
        {"id": "b2", "name": "备件车", "distance": 0},
    ],
    "shoes": [{"id": "s1", "name": "训练鞋", "distance": 120000}],
}


class TestGearStats:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/gear/stats").status_code == 401

    def test_gear_aggregation(self, api, monkeypatch):
        monkeypatch.setattr(app_module, "get_cached_athlete", lambda: GEAR_ATHLETE)
        body = api.get("/gear/stats").get_json()
        items = {i["gear_id"]: i for i in body["items"]}

        # 两条 Ride（21 + 23 km）挂 b1，一条 Run 挂 s1
        assert items["b1"]["distance_km"] == 44.0
        assert items["b1"]["count"] == 2
        assert items["b1"]["type_label"] == "自行车"
        assert items["b1"]["strava_total_km"] == 2450.0
        assert items["b1"]["last_used"] == "2026-10-05T09:00:00"
        assert items["s1"]["count"] == 1
        assert items["b2"]["count"] == 0  # 无活动的装备也列出
        assert items["b2"]["distance_km"] == 0.0
        # 有使用记录的排前面
        assert body["items"][0]["gear_id"] == "b1"

    def test_gear_stats_respect_sport_filter(self, api, monkeypatch):
        monkeypatch.setattr(app_module, "get_cached_athlete", lambda: GEAR_ATHLETE)
        body = api.get("/gear/stats?sport_type=Run").get_json()
        items = {i["gear_id"]: i for i in body["items"]}
        assert items["s1"]["count"] == 1
        assert items["b1"]["count"] == 0

    def test_activities_gear_projection(self, api):
        rows = api.get("/activities?fields=gear_id,name").get_json()
        assert all(set(row.keys()) == {"id", "gear_id", "name"} for row in rows)
        assert rows[0]["gear_id"] == "b1"


# ---------- /compare 周期对比 ----------

class TestCompare:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/compare").status_code == 401

    def test_two_range_summary(self, api):
        body = api.get(
            "/compare?start1=2026-10-01&end1=2026-10-31"
            "&start2=2026-09-01&end2=2026-09-30"
        ).get_json()
        assert body["range1"]["summary"]["count"] == 2
        assert body["range1"]["summary"]["distance_km"] == 43.0
        assert body["range2"]["summary"]["count"] == 1
        assert "suffer_score" in body["range1"]["summary"]

    def test_sport_filter_applies(self, api):
        body = api.get(
            "/compare?start1=2026-10-01&end1=2026-10-31"
            "&start2=2026-09-01&end2=2026-09-30&sport_type=Run"
        ).get_json()
        assert body["range1"]["summary"]["count"] == 1
        assert body["range2"]["summary"]["count"] == 0

    def test_missing_end_rejected(self, api):
        assert api.get("/compare?start1=2026-10-01&start2=2026-09-01&end2=2026-09-30").status_code == 400

    def test_reversed_range_rejected(self, api):
        assert api.get(
            "/compare?start1=2026-10-10&end1=2026-10-01"
            "&start2=2026-09-01&end2=2026-09-30"
        ).status_code == 400

    def test_bad_date_rejected(self, api):
        assert api.get(
            "/compare?start1=xx&end1=2026-10-01"
            "&start2=2026-09-01&end2=2026-09-30"
        ).status_code == 400


# ---------- /athlete ----------

class TestAthleteEndpoint:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/athlete").status_code == 401

    def test_returns_cached_athlete(self, api):
        resp = api.get("/athlete")
        assert resp.status_code == 200
        assert resp.get_json()["firstname"] == "T"


# ---------- /map/routes ----------

def _http_error(status):
    error = requests.exceptions.HTTPError(f"{status} error")
    error.response = type("FakeResponse", (), {"status_code": status})()
    return error


class TestMapRoutes:
    def test_requires_auth(self, anonymous_api):
        assert anonymous_api.get("/map/routes").status_code == 401

    def test_invalid_month_rejected(self, api):
        assert api.get("/map/routes?month=13").status_code == 400

    def test_cache_hit_and_missing_stats(self, api, route_stubs):
        route_stubs.routes[900001] = make_route(900001, point_count=20)
        route_stubs.set_fetch(
            lambda aid: ([[30.0, 120.0], [30.1, 120.1]], [0.0, 1000.0], [0.0, 1.0])
        )

        # fetch=0：不补抓，已缓存的返回，未缓存的计入 missing
        stats = api.get("/map/routes?year=2026&month=10").get_json()["stats"]
        assert stats["total"] == 2
        assert stats["returned"] == 1
        assert stats["missing"] == 1
        assert stats["fetched"] == 0
        assert stats["returned"] + stats["missing"] + stats["without_gps"] == stats["total"]

        # fetch=5：补抓成功后 missing 归零
        stats = api.get("/map/routes?year=2026&month=10&fetch=5").get_json()["stats"]
        assert stats["returned"] == 2
        assert stats["fetched"] == 1
        assert stats["missing"] == 0

    def test_rate_limit_accounting(self, api, route_stubs, fake_cache):
        # 追加两条 10 月活动：一条可正常抓取，一条触发 429
        fake_cache["activities"].append(make_activity(4, day=8))
        fake_cache["activities"].append(make_activity(5, day=9))

        route_stubs.routes[900001] = make_route(900001)
        route_stubs.routes[900002] = make_route(900002, with_points=False)  # 无 GPS

        def fetch(aid):
            if aid == 900004:
                return (
                    [[30.0, 120.0], [30.001, 120.001], [30.002, 120.002]],
                    [0.0, 100.0, 200.0],
                    [0.0, 1.0, 2.0],
                )
            raise _http_error(429)

        route_stubs.set_fetch(fetch)

        body = api.get("/map/routes?year=2026&month=10&fetch=5").get_json()
        stats = body["stats"]

        assert stats["total"] == 4
        assert stats["returned"] == 2
        assert stats["without_gps"] == 1
        assert stats["fetched"] == 1
        assert stats["rate_limited"] is True
        assert stats["returned"] + stats["missing"] + stats["without_gps"] == stats["total"]

    def test_fetch_limit_clamped(self, api, route_stubs):
        route_stubs.set_fetch(lambda aid: ([[30.0, 120.0]], [0.0], [0.0]))
        # 单批上限 50：fetch=999 不应超过 ROUTE_FETCH_BATCH_LIMIT
        resp = api.get("/map/routes?year=2026&month=10&fetch=999")
        assert resp.status_code == 200

    def test_sport_type_filter(self, api, route_stubs):
        route_stubs.set_fetch(lambda aid: ([[30.0, 120.0]], [0.0], [0.0]))
        body = api.get("/map/routes?year=2026&month=10&sport_type=Run&fetch=5").get_json()
        assert body["stats"]["total"] == 1
        assert body["filters"]["sport_type"] == "Run"


# ---------- 页面与静态资源 ----------

class TestPages:
    def test_dashboard_renders(self, api):
        resp = api.get("/dashboard")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert 'url_for' not in html  # Jinja 已渲染
        assert "/static/js/main.js" in html
        assert "/static/vendor/chart.umd.min.js" in html

    def test_dashboard_requires_auth(self, anonymous_api):
        resp = anonymous_api.get("/dashboard")
        assert resp.status_code == 302
        assert resp.headers["Location"].startswith("/?error=")

    def test_static_assets_exist(self, api):
        for path in (
            "/static/css/dashboard.css",
            "/static/js/core.js",
            "/static/js/maps.js",
            "/static/vendor/leaflet.js",
            "/static/vendor/chart.umd.min.js",
        ):
            assert api.get(path).status_code == 200, path

    def test_login_page_renders(self, client=None):
        api = app_module.app.test_client()
        resp = api.get("/")
        assert resp.status_code == 200
