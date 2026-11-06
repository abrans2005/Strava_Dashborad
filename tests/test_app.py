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
